
import { Construct } from '@aws-cdk/core';
import * as lambda from '@aws-cdk/aws-lambda';
import {Table} from '@aws-cdk/aws-dynamodb'
export interface LambdasProps {
    dynamoTable: Table;
    dynamoTableNName: string;
}
export class DeployLambdas extends Construct{
    private _lambdas: lambda.Function;
    constructor(parent: Construct, name: string, props: LambdasProps) {
        super(parent, name);

        const notesLambda = new lambda.Function(this, 'AppSyncNotesHandler', {
            runtime: lambda.Runtime.NODEJS_12_X,
            handler: 'main.handler',
            code: lambda.Code.fromAsset('lambda-fns'),
            memorySize: 1024
          });

        const getOneLambda = new lambda.Function(this, 'getOneItemFunction', {
            code: new lambda.AssetCode('src'),
            handler: 'get-one.handler',
            runtime: lambda.Runtime.NODEJS_10_X,
            environment: {
                TABLE_NAME: props.dynamoTableNName,
                PRIMARY_KEY: 'itemId'
            }
        });
        props.dynamoTable.grantReadWriteData
    }
}