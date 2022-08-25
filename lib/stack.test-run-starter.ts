import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);

const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);

const formatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/New_York",
});

const hasScheduledTest = async (
  now: number
): Promise<{
  isTestScheduled: boolean;
  pk?: string;
  sk?: number;
}> => {
  console.log(
    `querying for: tests ending after: ${formatter.format(
      now
    )} and starting before ${formatter.format(now)}`
  );
  const result = await documentClient.send(
    new QueryCommand({
      TableName: process.env.TABLE_NAME || "",
      // query to confirm we have an endtime later than now
      // hence a test should be running
      KeyConditionExpression: "pk = :pk and sk > :now  ",
      ExpressionAttributeValues: {
        ":pk": "test-schedule",
        ":now": now,
      },
      ExpressionAttributeNames: {
        "#startDate": "startDate",
        "#pickedUpTime": "pickedUpTime",
      },
      FilterExpression:
        "#startDate <= :now AND attribute_not_exists(#pickedUpTime)",
      ProjectionExpression: "startDate, endDate, pk, sk",
    })
  );

  if (result.Items && result.Count) {
    console.log("query results:", result.Items);
    const item = result.Items[0] as {
      startDate: number;
      endDate: number;
      pk: string;
      sk: number;
    };
    return {
      isTestScheduled: true,
      ...item,
    };
  }
  console.log(`no test scheduled to start before ${now} and end after ${now}`);
  return {
    isTestScheduled: false,
  };
};

const markTestAsRunning = async ({
  pk,
  sk,
  now,
}: {
  now: number;
  pk: string;
  sk: number;
}) => {
  console.log("picking up test", {
    pk,
    sk,
    now,
  });
  const result = await documentClient.send(
    new UpdateCommand({
      TableName: process.env.TABLE_NAME || "",
      // query to confirm we have an endtime later than now
      // hence a test should be running
      Key: {
        pk: pk,
        sk: sk,
      },
      UpdateExpression: "SET #pickedUpTime = :pickedUpTime",
      ExpressionAttributeValues: {
        ":pickedUpTime": now,
      },
      ExpressionAttributeNames: {
        "#pickedUpTime": "pickedUpTime",
      },
      ReturnValues: "ALL_NEW",
      ConditionExpression: "attribute_not_exists(#pickedUpTime)",
    })
  );
  console.log("pickup test results:", result.Attributes);
};

const handler = async () => {
  const now = Date.now();
  try {
    await client.waitForInitialization();
    const { isTestScheduled, pk, sk } = await hasScheduledTest(now);
    if (isTestScheduled && pk && sk) {
      markTestAsRunning({ pk, sk, now });
      return JSON.stringify({
        isTestScheduled,
        time: now,
      });
    }
  } catch (error) {
    console.error("error", error);
  }
  return JSON.stringify({
    isTestScheduled: false,
    time: now,
  });
};

export { handler };
