import * as cdk from '@aws-cdk/core';
import * as codecommit from "@aws-cdk/aws-codecommit";
import * as amplify from "@aws-cdk/aws-amplify";
import * as S3 from "@aws-cdk/aws-s3";
import * as Codebuild from "@aws-cdk/aws-codebuild";
import * as IAM from "@aws-cdk/aws-iam";

import { envVars } from './config';
import { CfnOutput } from '@aws-cdk/core';
import { PublicS3Bucket } from './DeployPublicS3Bucket';


export class LearnE2EInfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new PublicS3Bucket(this, 'StaticSite', {
      domainName: envVars.DOMAIN_NAME,//this.node.tryGetContext('domain'),
      siteSubDomain:  envVars.SUB_DOMAIN_NAME,//this.node.tryGetContext('subdomain'),
      enableCloudFrontDist: false,
      enableRoute53: true,
      enableSslCert: false,
      sslCertArn: null as any,
      creadeHostedZone: false,
      enableLoggingAccess: true
    });
    bucket
    //S3.Bucket.fromBucketName
    // S3 bucket for a static website

    // codebuild project setup
    const webhooks: Codebuild.FilterGroup[] = [
      Codebuild.FilterGroup.inEventOf(
        Codebuild.EventAction.PUSH,
        Codebuild.EventAction.PULL_REQUEST_MERGED
      )//.andHeadRefIs(envVars.BUILD_BRANCH)
      .andBranchIs(envVars.BUILD_BRANCH_NAME),
    ];

    const webRepo = Codebuild.Source.gitHub({
      owner: envVars.REPO_OWNER!,
      repo: envVars.WEB_REPO_NAME!,
      webhook: true,
      webhookFilters: webhooks,
      reportBuildStatus: true,
    });

    const projectBuild = new Codebuild.Project(
      this,
      `${envVars.WEBSITE_NAME}-build`,
      {
        buildSpec: Codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
        projectName: `${envVars.WEBSITE_NAME}-build`,
        environment: {
          buildImage: Codebuild.LinuxBuildImage.STANDARD_3_0,//STANDARD_3_0
          computeType: Codebuild.ComputeType.SMALL,
          environmentVariables: {
            S3_BUCKET: {
              value: bucket.bucketName,
            },
            // CLOUDFRONT_DIST_ID: {
            //   value: cloudfrontDist.distributionId,
            // },
          },
        },
        source: webRepo,
        //timeout: cdk.Duration.minutes(20),//Default: Duration.hours(1)
      }
    );
    // iam policy to push your build to S3
    projectBuild.addToRolePolicy(
      new IAM.PolicyStatement({
        effect: IAM.Effect.ALLOW,
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
        actions: [
          's3:GetBucket*',
          's3:List*',
          's3:GetObject*',
          's3:DeleteObject',
          's3:PutObject*',
        ],
      })
    );


  }
}
