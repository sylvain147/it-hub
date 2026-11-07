import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';

let client: DynamoDBDocumentClient | null = null;

export function ddb(): DynamoDBDocumentClient {
  if (!client) {
    const base = new DynamoDBClient(
      config.dynamoEndpoint
        ? {
            endpoint: config.dynamoEndpoint,
            region: 'local',
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {},
    );
    client = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
    });
  }
  return client;
}

export function resetDdb() {
  client = null;
}

/** Requête paginée complète. */
export async function queryAll<T>(input: Omit<QueryCommandInput, 'TableName'>): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb().send(new QueryCommand({ TableName: config.tableName, ...input, ExclusiveStartKey }));
    items.push(...((res.Items ?? []) as T[]));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export function isConditionFailed(e: unknown): boolean {
  return (e as { name?: string }).name === 'ConditionalCheckFailedException';
}

/** Compteur atomique (`COUNTER` / `name`) : renvoie la valeur suivante (1, 2, 3…). */
export async function nextCounter(name: string, by = 1): Promise<number> {
  const res = await ddb().send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: { pk: 'COUNTER', sk: name },
      UpdateExpression: 'ADD n :by',
      ExpressionAttributeValues: { ':by': by },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  return Number(res.Attributes?.n);
}
