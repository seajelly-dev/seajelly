import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";

export interface R2Credentials {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function createR2Client(creds: R2Credentials): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: creds.endpoint,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

export async function uploadToR2(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer | Uint8Array,
  contentType?: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType ?? "application/octet-stream",
    }),
  );
}

export async function deleteFromR2(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export async function headFromR2(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ contentLength: number; contentType: string | undefined } | null> {
  try {
    const res = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return {
      contentLength: res.ContentLength ?? 0,
      contentType: res.ContentType,
    };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "name" in err && err.name === "NotFound") {
      return null;
    }
    throw err;
  }
}

export async function copyInR2(
  client: S3Client,
  bucket: string,
  sourceKey: string,
  destKey: string,
): Promise<void> {
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destKey,
    }),
  );
}

export async function testR2Connection(
  client: S3Client,
  bucket: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}
