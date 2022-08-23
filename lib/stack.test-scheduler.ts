import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import axios from "axios";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);

const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);
const projectKey = process.env.PROJECT_KEY;
const featureFlagKey = process.env.FEATURE_FLAG_KEY;
const environmentKey = process.env.ENVIRONMENT_KEY;
const launchDarklyApiKey = process.env.API_KEY;

const url = `https://app.launchdarkly.com/api/v2/projects/${projectKey}/flags/${featureFlagKey}/environments/${environmentKey}/workflows`;

const formatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/New_York",
});

const createWorkflow = (startDate: number, endDate: number) => {
  const formattedStartDate = formatter.format(startDate);
  const formattedEndDate = formatter.format(startDate);
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
  await axios.post(url, createWorkflow(startDate, endDate), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `${launchDarklyApiKey}`,
      "LD-API-Version": "beta",
    },
  });
};

const handler = async (event: { startDate: number; endDate: number }) => {
  const { startDate, endDate } = event;
  try {
    await client.waitForInitialization();
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
