import * as lambda from "aws-cdk-lib/aws-lambda";
import * as stepFunctions from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { config } from "dotenv";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { LambdaRestApi } from "aws-cdk-lib/aws-apigateway";
import { StateMachine, StateMachineType } from "aws-cdk-lib/aws-stepfunctions";

const runtime = lambda.Runtime.NODEJS_16_X;
const timeout = cdk.Duration.seconds(10);
const memorySize = 2048;

export class TestRunnerMachine extends Construct {
  public stateMachine: StateMachine;

  constructor(
    scope: Construct,
    id: string,
    properties: {
      table: Table;
      apiV1: LambdaRestApi;
      apiV2: LambdaRestApi;
      environment: any;
    }
  ) {
    super(scope, id);

    config();

    const { environment: _environment, apiV1, apiV2 } = properties;

    const environment: any = {
      ..._environment,
      LAUNCHDARKLY_CLIENT_ID: process.env.LAUNCHDARKLY_CLIENT_ID || "",
    };

    const worker = new NodejsFunction(this, "worker", {
      memorySize,
      timeout,
      runtime,
      description:
        "The worker which will use flags to determine which API to use in the DataSourceSwitcher",
      environment: {
        ...environment,
        VERSION_1_API_URL: apiV1.url,
        VERSION_2_API_URL: apiV2.url,
        API_KEY: process.env.API_KEY || "",
      },
      entry: "./lib/stack.worker.ts",
    });

    const workerTask = new tasks.LambdaInvoke(this, "load-test-worker", {
      lambdaFunction: worker,
      // Lambda's result is in the attribute `Payload`
      outputPath: "$.Payload",
    });

    const definition = workerTask;

    this.stateMachine = new stepFunctions.StateMachine(
      this,
      "load-test-state-machine",
      {
        definition,
        stateMachineType: StateMachineType.EXPRESS,
        timeout: Duration.seconds(5),
      }
    );
  }
}
