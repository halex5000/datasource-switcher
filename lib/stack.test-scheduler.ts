/* eslint-disable unicorn/numeric-separators-style */
import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import axios from "axios";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);

const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);
const projectKey = process.env.PROJECT_KEY;
const loadTestFeatureFlagKey = process.env.LOAD_TEST_FEATURE_FLAG_KEY || "";
const dataSourceFeatureFlagKey = process.env.DATASOURCE_FEATURE_FLAG_KEY || "";
const environmentKey = process.env.ENVIRONMENT_KEY;
const launchDarklyApiKey = process.env.API_KEY;

const url = (featureFlagKey: string) =>
  `https://app.launchdarkly.com/api/v2/projects/${projectKey}/flags/${featureFlagKey}/environments/${environmentKey}/workflows`;

let formatter: Intl.DateTimeFormat;

const initFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  });

const createDataSourceControllerWorkflow = (
  startDate: number,
  endDate: number
) => {
  const formattedStartDate = formatter.format(startDate);
  const formattedEndDate = formatter.format(endDate);
  return {
    name: `Workflow Data Source Controller ${formattedStartDate} to ${formattedEndDate}`,
    description: `Created by automation on ${formatter.format(Date.now())}`,
    kind: "custom",
    stages: [
      {
        name: "Set default value to version 1.0 at start time and turn flag on",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "absolute",
            executionDate: startDate,
          },
        ],
        action: {
          kind: "patch",
          instructions: [
            {
              kind: "updateFallthroughVariationOrRollout",
              variationId: "3490cabb-7813-4d18-9304-c92273d7eccb",
            },
            { kind: "turnFlagOn" },
          ],
        },
      },
      {
        name: "Target a user",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "relative",
            waitDuration: 1,
            waitDurationUnit: "minute",
          },
        ],
        action: {
          kind: "patch",
          instructions: [
            {
              kind: "addUserTargets",
              values: ["alex"],
              variationId: "f9fe79be-201a-4b23-9100-7dd45675a4cd",
            },
          ],
        },
      },
      {
        name: "Set rollout weights to canary test the new API",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "relative",
            waitDuration: 2,
            waitDurationUnit: "minute",
          },
        ],
        action: {
          kind: "patch",
          instructions: [
            {
              kind: "updateFallthroughVariationOrRollout",
              rolloutWeights: {
                "3490cabb-7813-4d18-9304-c92273d7eccb": 90000,
                "f9fe79be-201a-4b23-9100-7dd45675a4cd": 10000,
              },
            },
          ],
        },
      },
      {
        name: "Ramping up new API weight in rollout",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "relative",
            waitDuration: 2,
            waitDurationUnit: "minute",
          },
        ],
        action: {
          kind: "patch",
          instructions: [
            {
              kind: "updateFallthroughVariationOrRollout",
              rolloutWeights: {
                "3490cabb-7813-4d18-9304-c92273d7eccb": 40000,
                "f9fe79be-201a-4b23-9100-7dd45675a4cd": 60000,
              },
            },
          ],
        },
      },
      {
        name: "Ramping up to 90% new API",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "relative",
            waitDuration: 2,
            waitDurationUnit: "minute",
          },
        ],
        action: {
          kind: "patch",
          instructions: [
            {
              kind: "updateFallthroughVariationOrRollout",
              rolloutWeights: {
                "3490cabb-7813-4d18-9304-c92273d7eccb": 10000,
                "f9fe79be-201a-4b23-9100-7dd45675a4cd": 90000,
              },
            },
          ],
        },
      },
      {
        name: "Hard cutoff of new API version, turning flag off",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "relative",
            waitDuration: 2,
            waitDurationUnit: "minute",
          },
        ],
        action: {
          kind: "patch",
          instructions: [
            { kind: "turnFlagOff" },
            {
              kind: "addUserTargets",
              values: ["alex"],
              variationId: "3490cabb-7813-4d18-9304-c92273d7eccb",
            },
          ],
        },
      },
    ],
  };
};

const createLoadTestControllerWorkflow = (
  startDate: number,
  endDate: number
) => {
  const formattedStartDate = formatter.format(startDate);
  const formattedEndDate = formatter.format(endDate);
  return {
    name: `Workflow Load Test Controller ${formattedStartDate} to ${formattedEndDate}`,
    description: `Created by automation on ${formatter.format(Date.now())}`,
    kind: "custom",
    stages: [
      {
        name: "Scheduling test start time",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "absolute",
            executionDate: startDate,
          },
        ],
        action: { kind: "patch", instructions: [{ kind: "turnFlagOn" }] },
      },
      {
        name: "Scheduling test end time",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "absolute",
            executionDate: endDate,
          },
        ],
        action: { kind: "patch", instructions: [{ kind: "turnFlagOff" }] },
      },
    ],
  };
};

const scheduleNewTest = async (startDate: number, endDate: number) => {
  const startTime = formatter.format(startDate);
  const endTime = formatter.format(endDate);
  await documentClient.send(
    new UpdateCommand({
      TableName: process.env.TABLE_NAME || "",
      Key: {
        pk: `test-schedule`,
        sk: endDate,
      },
      UpdateExpression:
        "SET startDate = :startDate, endDate = :endDate, startTime = :startTime, endTime = :endTime",
      ExpressionAttributeValues: {
        ":startDate": startDate,
        ":endDate": endDate,
        ":startTime": startTime,
        ":endTime": endTime,
      },
      ReturnValues: "ALL_NEW",
    })
  );
  return {
    startTime,
    endTime,
    startDate,
    endDate,
  };
};

const scheduleWorkflowInLaunchDarkly = async (
  startDate: number,
  endDate: number
) => {
  const workflowStartDate = new Date(startDate);
  // set workflow start date to one minute before so we increase the likelihood we'll be ready for the test.
  workflowStartDate.setMinutes(workflowStartDate.getMinutes() - 1);
  const workflowStartTime = workflowStartDate.getTime();
  const loadTestWorkflow = axios.post(
    url(loadTestFeatureFlagKey),
    createLoadTestControllerWorkflow(workflowStartTime, endDate),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `${launchDarklyApiKey}`,
        "LD-API-Version": "beta",
      },
    }
  );
  const dataSourceWorkflow = axios.post(
    url(dataSourceFeatureFlagKey),
    createDataSourceControllerWorkflow(workflowStartTime, endDate),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `${launchDarklyApiKey}`,
        "LD-API-Version": "beta",
      },
    }
  );
  await Promise.all([loadTestWorkflow, dataSourceWorkflow]);
};

const handler = async (event: { startDate: number; endDate: number }) => {
  let { startDate, endDate } = event;
  try {
    await client.waitForInitialization();

    if (!formatter) {
      const timeZone = await client.variation(
        "load-test-timezone",
        {
          key: "1234567",
        },
        "America/New_York"
      );
      formatter = initFormatter(timeZone);
    }

    if (!startDate || !endDate) {
      console.log(
        "start or end date not provided, using feature settings instead starting 2 minutes from now"
      );
      const duration = await client.variation(
        "load-test-duration",
        {
          key: "1234567",
        },
        10
      );
      const now = new Date();
      now.setMinutes(now.getMinutes() + 2);
      startDate = now.getTime();
      const temporaryEndDate = new Date(startDate);
      temporaryEndDate.setMinutes(temporaryEndDate.getMinutes() + duration);
      endDate = temporaryEndDate.getTime();
    }

    await scheduleWorkflowInLaunchDarkly(startDate, endDate);

    const {
      startDate: scheduledStartDate,
      startTime,
      endDate: scheduledEndDate,
      endTime,
    } = await scheduleNewTest(startDate, endDate);

    return {
      message: "test scheduled",
      workflowScheduled: true,
      testScheduled: true,
      scheduledStartDate,
      scheduledEndDate,
      startTime,
      endTime,
    };
  } catch (error) {
    console.error("error", error);
  }
  return {
    message: "no test scheduled",
  };
};

export { handler };
