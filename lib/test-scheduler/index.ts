import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import axios from "axios";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);

const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);
const projectKey = process.env.PROJECT_KEY;
const featureFlagKey = process.env.FEATURE_FLAG_KEY;
const environmentKey = process.env.ENVIRONMENT_KEY;
const templateKey = process.env.TEMPLATE_KEY;
const launchDarklyApiKey = process.env.API_KEY;

const url = `https://app.launchdarkly.com/api/v2/projects/${projectKey}/flags/${featureFlagKey}/environments/${environmentKey}/workflows?templateKey=${templateKey}`;

const createWorkflow = (date: number) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const formattedDate = formatter.format(date);
  return {
    name: `Workflow Load Test Controller ${formattedDate}`,
    description: `Created by automation on ${formatter.format(Date.now())}`,
    kind: "custom",
    stages: [
      {
        name: "Scheduling",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "absolute",
            executionDate: date,
          },
        ],
        action: { kind: "patch", instructions: [{ kind: "turnFlagOn" }] },
      },
      {
        name: "Waiting",
        conditions: [
          {
            kind: "schedule",
            scheduleKind: "relative",
            waitDuration: 30,
            waitDurationUnit: "minute",
          },
        ],
        action: {
          kind: "patch",
          instructions: [{ kind: "turnFlagOff" }],
        },
      },
    ],
  };
};

const deleteExistingTestParameters = async () => {
  await documentClient.send(
    new DeleteCommand({
      TableName: process.env.TABLE_NAME || "",
      Key: {
        pk: `loadTestParams`,
        sk: 1,
      },
    })
  );
};

const createWorkflowInLaunchDarkly = async (date: number) => {
  await axios.post(url, createWorkflow(date), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `${launchDarklyApiKey}`,
    },
  });
};

const handler = async (event: any) => {
  const { date }: { date: number } = event;
  try {
    await client.waitForInitialization();
    await deleteExistingTestParameters();
    await createWorkflowInLaunchDarkly(date);
  } catch (error) {
    console.error("error", error);
  }
};

export { handler };
