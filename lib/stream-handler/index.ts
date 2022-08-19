import { init } from "launchdarkly-node-server-sdk";
import { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { AttributeValue } from "@aws-sdk/client-dynamodb-streams";
const clientId = process.env.LAUNCHDARKLY_CLIENT_ID || "";
const client = init(clientId);
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const documentClient = DynamoDBDocumentClient.from(dynamoClient);

const addConnections = async (event: DynamoDBStreamEvent) => {
  try {
    const newConnections: Set<string> = new Set<string>();

    for (const record of event.Records) {
      console.log("Stream record:", JSON.stringify(record, undefined, 2));
      if (record.eventName == "INSERT" && record.dynamodb?.NewImage) {
        const newImage = unmarshall(
          record.dynamodb.NewImage as Record<string, AttributeValue>
        );
        newConnections.add(newImage.connectionId);
      }
    }

    console.log("newConnections", newConnections);
    console.log("newConnections size", newConnections.size);

    if (newConnections.size > 0) {
      await documentClient.send(
        new UpdateCommand({
          TableName: process.env.TABLE_NAME || "",
          Key: {
            pk: `connections-aggregate`,
          },
          UpdateExpression: "ADD #connections :newConnections",
          ExpressionAttributeNames: {
            "#connections": "connections-list",
          },
          ExpressionAttributeValues: {
            ":newConnections": newConnections,
          },
        })
      );
    }
  } catch (error: any) {
    console.error("error adding connection to connections set", error);
  }
};

const removeConnections = async (event: DynamoDBStreamEvent) => {
  try {
    const disconnections: Set<string> = new Set<string>();

    for (const record of event.Records) {
      console.log("Stream record:", JSON.stringify(record, undefined, 2));
      if (record.eventName == "REMOVE" && record.dynamodb?.OldImage) {
        const oldImage = unmarshall(
          record.dynamodb.OldImage as Record<string, AttributeValue>
        );
        disconnections.add(oldImage.connectionId);
      }
    }

    console.log("disconnections", disconnections);
    console.log("disconnections size", disconnections.size);

    if (disconnections.size > 0) {
      await documentClient.send(
        new UpdateCommand({
          TableName: process.env.TABLE_NAME || "",
          Key: {
            pk: `connections-aggregate`,
          },
          UpdateExpression: "DELETE #connections :disconnections",
          ExpressionAttributeNames: {
            "#connections": "connections-list",
          },
          ExpressionAttributeValues: {
            ":disconnections": disconnections,
          },
        })
      );
    }
  } catch (error: any) {
    console.error("error removing connection from connections set", error);
  }
};

const handler = async (event: DynamoDBStreamEvent) => {
  const statusCode = 200;
  const body: any = {};
  try {
    await client.waitForInitialization();
    body.initialization = "success";
    await addConnections(event);
    await removeConnections(event);
  } catch (error: any) {
    console.error("initializing", error);
  }
  return {
    statusCode,
    body: JSON.stringify(body),
  };
};

export { handler };
