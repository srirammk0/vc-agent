import { put, head } from "@vercel/blob";
import fs from "fs";
import path from "path";

export async function uploadToBlob(filePath: string, buffer: Buffer): Promise<void> {
  const blobPath = filePath; // Keep the same path structure e.g. "brain/startups/arc-ai.md"
  await put(blobPath, buffer, {
    access: "public",
    addRandomSuffix: false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

export async function downloadFromBlob(blobPath: string): Promise<Buffer | null> {
  // Since we use public access and predictable URLs without random suffix,
  // we can just fetch it directly if we know the domain, but Vercel Blob
  // head() gives us the downloadUrl.
  try {
    const details = await head(blobPath, { token: process.env.BLOB_READ_WRITE_TOKEN });
    if (!details) return null;
    
    const res = await fetch(details.downloadUrl);
    if (!res.ok) return null;
    
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error(`[blob] failed to download ${blobPath}:`, err);
    return null;
  }
}
