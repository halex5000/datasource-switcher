import { init } from "launchdarkly-node-server-sdk";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);
const config = { region: process.env.AWS_REGION };
const dynamoClient = new DynamoDBClient(config);
const documentClient = DynamoDBDocumentClient.from(dynamoClient);

const getTestParameters = async () => {
  const result = await documentClient.send(
    new GetItemCommand({
      TableName: process.env.TABLE_NAME || "",
      Key: {
        pk: {
          S: "loadTestParams",
        },
        sk: {
          N: "1",
        },
      },
      ProjectionExpression: "startTime, endTime",
    })
  );

  if (result.Item) {
    return unmarshall(result.Item) as {
      startTime: number;
      endTime: number;
    };
  } else {
    const now = new Date();
    const startTime = Date.parse(now.toString());
    const soon = new Date(now.setMinutes(now.getMinutes() + 5));
    const endTime = Date.parse(soon.toString());

    await documentClient.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME || "",
        Key: {
          pk: `loadTestParams`,
          sk: 1,
        },
        UpdateExpression: "SET startTime = :startTime, endTime = :endTime",
        ExpressionAttributeValues: {
          ":startTime": startTime,
          ":endTime": endTime,
        },
        ReturnValues: "ALL_NEW",
      })
    );
    return {
      startTime,
      endTime,
    };
  }
};

export const handler = async (event: any) => {
  console.log(event);

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

    const testParameters = await getTestParameters();
    const now = Date.now();

    console.log("evaluation parameters", {
      loadTestEnabled,
      startTime: testParameters.startTime,
      endTime: testParameters.endTime,
      now,
      startTimeOkay: testParameters.startTime < now,
      endTimeOkay: testParameters.endTime > now,
    });

    loadTestEnabled =
      loadTestEnabled &&
      testParameters.startTime < now &&
      testParameters.endTime > now;
  } catch (error: any) {
    console.error("error encountered", error);
  }

  return {
    loadTestEnabled,
  };
};
