import * as cdk from '@aws-cdk/core';
import * as codecommit from "@aws-cdk/aws-codecommit";
import * as amplify from "@aws-cdk/aws-amplify";
import * as S3 from "@aws-cdk/aws-s3";
import * as Codebuild from "@aws-cdk/aws-codebuild";
import * as IAM from "@aws-cdk/aws-iam";

import { envVars } from './config';
import { CfnOutput } from '@aws-cdk/core';


export class LearnE2EInfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for a static website
    const bucket = new S3.Bucket(this, envVars.BUCKET_NAME, {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    /* uncomment this if you do not require cloudfront and comment everything related to cloudfront below */
    bucket.grantPublicAccess('*', 's3:GetObject');

    new CfnOutput(this, 
      "s3-bucket-info", {
        description: 'created public Bucket',
        value: bucket.bucketArn,
      });

    // codebuild project setup
    const webhooks: Codebuild.FilterGroup[] = [
      Codebuild.FilterGroup.inEventOf(
        Codebuild.EventAction.PUSH,
        Codebuild.EventAction.PULL_REQUEST_MERGED
      ).andHeadRefIs(envVars.BUILD_BRANCH),
    ];

    const webRepo = Codebuild.Source.gitHub({
      owner: envVars.REPO_OWNER!,
      repo: envVars.WEB_REPO_NAME!,
      webhook: true,
      webhookFilters: webhooks,
      reportBuildStatus: true,
    });

    const project = new Codebuild.Project(
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
    project.addToRolePolicy(
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
