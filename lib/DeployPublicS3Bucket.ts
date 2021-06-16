import * as cdk from '@aws-cdk/core';
import * as S3 from "@aws-cdk/aws-s3";
import { Construct } from '@aws-cdk/core';
import cloudfront = require('@aws-cdk/aws-cloudfront');
import route53 = require('@aws-cdk/aws-route53');
import s3deploy = require('@aws-cdk/aws-s3-deployment');
import acm = require('@aws-cdk/aws-certificatemanager');
import targets = require('@aws-cdk/aws-route53-targets/lib');
import { HostedZone, IHostedZone } from '@aws-cdk/aws-route53';
import { Bucket } from '@aws-cdk/aws-s3';
 
export interface StaticSiteProps {
    domainName: string;
    siteSubDomain: string;
    enableSslCert: boolean;
    sslCertArn: string;
    enableRoute53: boolean;
    enableCloudFrontDist: boolean;
    creadeHostedZone: boolean;
    enableLoggingAccess: boolean;
}

export class PublicS3Bucket extends Construct{
    private _bucket: Bucket;
    private _loggingBucket: Bucket;
    private _certificateArn: string;
    private _zone: IHostedZone;

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
            websiteIndexDocument: 'index.html',
            websiteErrorDocument: 'index.html',
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
            this._certificateArn = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
                domainName: siteDomain,
                hostedZone: this._zone,
                region: 'us-east-1', // Cloudfront only checks this region for certificates.
            }).certificateArn;
            new cdk.CfnOutput(this, 'Certificate', { value: this._certificateArn });
        } else {
            this._certificateArn = props.sslCertArn;
        }

        var distribution = null
        //Requires _certificateArn
        if( props.enableCloudFrontDist === true) {
            distribution = new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
                aliasConfiguration: {
                    acmCertRef: this._certificateArn,
                    names: [ siteDomain ],
                    sslMethod: cloudfront.SSLMethod.SNI,
                    securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016,
                },
                originConfigs: [
                    {
                        customOriginSource: {
                            domainName: siteDomain,//siteBucket.bucketWebsiteDomainName,
                            originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                        },          
                        behaviors : [ {isDefaultBehavior: true}],
                    }
                ]
            });
            new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
        }  
        //Requires Zone and Distribution to be dfined
        if( props.enableRoute53 === true) {
            if(distribution != null){
                new route53.ARecord(this, 'SiteAliasRecord', {
                    recordName: siteDomain,
                    target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
                    zone: this._zone
                });
            } else {
                new route53.ARecord(this, 'SiteAliasRecord', {
                    recordName: siteDomain,
                    target: route53.RecordTarget.fromAlias(new targets.BucketWebsiteTarget(this._bucket)),
                    zone: this._zone
                });
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

    public get bucketName() {
        return this._bucket.bucketName;
    }
    public get bucketArn(){
        return this._bucket.bucketArn;
    }
}