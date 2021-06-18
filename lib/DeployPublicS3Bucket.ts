import * as cdk from '@aws-cdk/core';
import * as S3 from "@aws-cdk/aws-s3";
import { Construct } from '@aws-cdk/core';
import cloudfront = require('@aws-cdk/aws-cloudfront');
import route53 = require('@aws-cdk/aws-route53');
import s3deploy = require('@aws-cdk/aws-s3-deployment');
import acm = require('@aws-cdk/aws-certificatemanager');
import targets = require('@aws-cdk/aws-route53-targets/lib');
import { ARecord, HostedZone, IHostedZone } from '@aws-cdk/aws-route53';
import { Bucket } from '@aws-cdk/aws-s3';
import { DnsValidatedCertificate } from '@aws-cdk/aws-certificatemanager';
import { CloudFrontWebDistribution, OriginAccessIdentity } from '@aws-cdk/aws-cloudfront';
import { BucketDeployment, CacheControl } from '@aws-cdk/aws-s3-deployment';
import { Source } from '@aws-cdk/aws-codebuild';
 
export interface StaticSiteProps {
    domainName: string;
    siteSubDomain?: string;
    enableSslCert?: boolean;
    sslCertArn?: string;
    enableRoute53?: boolean;
    enableCloudFrontDist?: boolean;
    creadeHostedZone?: boolean;
    enableLoggingAccess?: boolean;
}
const defaultWebsiteIndexDocument: string = "index.html";

export class DeployStaticWebsite extends Construct{
    public readonly _bucket: Bucket;
    public readonly _loggingBucket: Bucket;
    public readonly _certificateArn: string;
    public readonly _zone: IHostedZone;
    public readonly _dnsRecord: ARecord;

   
    constructor(parent: Construct, name: string, props: StaticSiteProps) {
        
        super(parent, name);

        var siteDomain = [props.siteSubDomain,props.domainName].filter(Boolean).join(".");
        var loggingBucket: Bucket = null as any;
        if ( props.enableLoggingAccess === true ){
            loggingBucket = new S3.Bucket(this, 'SiteLoggingBucket', {
                bucketName: siteDomain + "-logging",
                removalPolicy: cdk.RemovalPolicy.DESTROY
            });
        }

        //super(scope, id, props);
        this._bucket = new S3.Bucket(this, 'SiteBucket', {
            bucketName: siteDomain,
            websiteIndexDocument: defaultWebsiteIndexDocument,
            websiteErrorDocument: defaultWebsiteIndexDocument,
            publicReadAccess: true,
            
            // The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
            // the new bucket, and it will remain in your account until manually deleted. By setting the policy to
            // DESTROY, cdk destroy will attempt to delete the bucket, but will error if the bucket is not empty.
            removalPolicy: cdk.RemovalPolicy.DESTROY,// NOT recommended for production code
            serverAccessLogsBucket: loggingBucket,
            serverAccessLogsPrefix: "logs/"
          }
        );
        /* uncomment this if you do not require cloudfront and comment everything related to cloudfront below */
        this._bucket.grantPublicAccess('*', 's3:GetObject');
        

        new cdk.CfnOutput(this, "s3-bucket-info", {description: 'created public Bucket', value: this._bucket.bucketArn });
        
        if( props.creadeHostedZone === true){
            this._zone = new route53.PublicHostedZone(this, 'HostedZone', {
                zoneName: props.domainName
              });
        }
        if (( props.enableRoute53 === true || props.enableSslCert === true) && (props.creadeHostedZone !== true)) {
            this._zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.domainName });
        }
        //Requires Zone to be available
        if( props.enableSslCert === true) {
            const certificate = this.createCertificate(siteDomain, this._zone);
            this._certificateArn = certificate.certificateArn;
            new cdk.CfnOutput(this, 'Certificate', { value: this._certificateArn });
        } /* else {
            this._certificateArn = props.sslCertArn!;
        }*/

        var distribution = null
        //Requires _certificateArn
        if( props.enableCloudFrontDist === true) {
            //distribution = this.createCloudFrontWebDistribution(this._bucket, this._certificateArn,siteDomain,)
            distribution = new cloudfront.CloudFrontWebDistribution(this, 'CloudfrontDistribution', {
                aliasConfiguration: {
                    acmCertRef: this._certificateArn,
                    names: [ siteDomain ],
                    sslMethod: cloudfront.SSLMethod.SNI,
                    securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016,
                },
                originConfigs: [
                    {
                        // customOriginSource: {
                        //     domainName: siteDomain,//siteBucket.bucketWebsiteDomainName,
                        //     originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                        // },    
                        s3OriginSource: {
                            s3BucketSource: this._bucket,
                            //Optional(bucket is public): originAccessIdentity: this.createOriginAccessIdentity(this._bucket),
                        },
                              
                        behaviors : [ {isDefaultBehavior: true, defaultTtl: cdk.Duration.days(60)}],
                    }
                    
                ],
                defaultRootObject: defaultWebsiteIndexDocument,
            });
            new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
        }  
        //Requires Zone and Distribution to be dfined
        if( props.enableRoute53 === true) {
            if(distribution != null){
                this._dnsRecord = this.createARecordForDistrubution(this._zone, siteDomain, distribution);
            } else {
                this._dnsRecord = this.createARecordForBucket(this._zone, siteDomain, this._bucket);
            }
        }    
        

        // Deploy site contents to S3 bucket
        // new s3deploy.BucketDeployment(this, 'DeployWithInvalidation', {
        //     sources: [ s3deploy.Source.asset('./site-contents') ],
        //     destinationBucket: siteBucket,
        //     distribution,
        //     distributionPaths: ['/*'],
        //   });    

    }
    private createCertificate(domainName: string, hostedZone: IHostedZone) {
        return new DnsValidatedCertificate(this, "SslCertificate", {
          domainName: domainName,
          hostedZone: hostedZone,
          region: "us-east-1",
        });
    }
    
    private lookupHostedZone(domainName: string) {
        const hostedZoneDomainName = domainName.replace(/.*?\.(.*)/, "$1");
        return HostedZone.fromLookup(this, "HostedZone", {
          domainName: hostedZoneDomainName,
        });
    }
    
    private createARecordForDistrubution(
        zone: IHostedZone,
        domainName: string,
        distribution: CloudFrontWebDistribution
      ) {
        return new route53.ARecord(this, "DnsARecord", {
          target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
          recordName: domainName,
          ttl: cdk.Duration.minutes(1),
          zone,
        });
    }

    private createARecordForBucket(
        zone: IHostedZone,
        domainName: string,
        bucket: Bucket
      ) {
        return new route53.ARecord(this, "DnsARecord", {
          target: route53.RecordTarget.fromAlias(new targets.BucketWebsiteTarget(bucket)),
          recordName: domainName,
          ttl: cdk.Duration.minutes(1),
          zone,
        });
    }

    private createOriginAccessIdentity(destinationBucket: Bucket) {
        const originAccessIdentity = new OriginAccessIdentity(this, "Oai", {
          comment: `OAI for ${destinationBucket.bucketName}`,
        });
        destinationBucket.grantRead(originAccessIdentity.grantPrincipal);
        return originAccessIdentity;
      }
    private createCloudFrontWebDistribution(
        destinationBucket: Bucket,
        //originAccessIdentity: OriginAccessIdentity,
        certificatArn: string,
        domainName: string,
        websiteIndexDocument: string,
        webACLId?: string
      ) {
        return new CloudFrontWebDistribution(this, "CloudfrontDistribution", {
            aliasConfiguration: {
                acmCertRef: certificatArn,
                names: [domainName],
            },
            originConfigs: [
                {
                    s3OriginSource: {
                        s3BucketSource: destinationBucket,
                        //originAccessIdentity,
                    },
                    behaviors: [{ isDefaultBehavior: true, defaultTtl: cdk.Duration.days(60),}],
                }
            ],
            //TODO:webACLId,
            defaultRootObject: websiteIndexDocument,
            errorConfigurations: [
                {
                    errorCode: 404,
                    errorCachingMinTtl: 300,
                    responseCode: 200,
                    responsePagePath: `/${websiteIndexDocument}`,
                },
            ],
        });
      }

    //Deploy static files to bucket:
    // private createBucketDeployment(
    //     websiteDistPath: string,
    //     destinationBucket: Bucket
    //   ) {
    //     return new BucketDeployment(this, "BucketDeployment", {
    //       sources: [Source.asset(websiteDistPath)],
    //       destinationBucket,
    //       cacheControl: [CacheControl.noCache()],
    //     });
    //   }
    
}