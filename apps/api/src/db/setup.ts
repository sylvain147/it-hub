import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { config } from '../config.js';
import { GSI1 } from './schema.js';

/** Crée la table en local (en production elle est créée par l'infrastructure CDK). */
export async function ensureLocalTable(endpoint: string): Promise<void> {
  const client = new DynamoDBClient({ endpoint, region: 'local', credentials: { accessKeyId: 'local', secretAccessKey: 'local' } });
  try {
    await client.send(new DescribeTableCommand({ TableName: config.tableName }));
    return;
  } catch {
    /* absente */
  }
  await client.send(
    new CreateTableCommand({
      TableName: config.tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'gsi1pk', AttributeType: 'S' },
        { AttributeName: 'gsi1sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: GSI1,
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
}
