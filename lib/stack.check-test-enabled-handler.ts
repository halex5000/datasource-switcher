import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);
const config = { region: process.env.AWS_REGION };
const dynamoClient = new DynamoDBClient(config);
const documentClient = DynamoDBDocumentClient.from(dynamoClient);

const isTestScheduled = async (now: number) => {
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
      },
      FilterExpression: "#startDate <= :now",
      ProjectionExpression: "startDate, endDate, pk, sk",
    })
  );

  if (result.Items && result.Count) {
    return true;
  }
  console.log(`no test scheduled to start before ${now} and end after ${now}`);
  return false;
};

export const handler = async () => {
  let loadTestEnabled = false;

  try {
    await client.waitForInitialization();

    loadTestEnabled = await client.variation(
      "load-test-controller",
      {
        key: "1234567",
      },
      false
    );

    if (loadTestEnabled) {
      const now = Date.now();

      const isScheduled = await isTestScheduled(now);

      console.log("evaluation parameters", {
        loadTestEnabled,
        now,
        isScheduled,
      });

      loadTestEnabled = loadTestEnabled && isScheduled;
    }
  } catch (error) {
    console.error("error encountered", error);
  }

  return {
    loadTestEnabled,
  };
};
