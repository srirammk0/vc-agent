import { list, del } from "@vercel/blob";

async function clearBlob() {
  console.log("Fetching blobs...");
  let cursor: string | undefined;
  let count = 0;
  
  do {
    const response = await list({
      cursor,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    
    if (response.blobs.length > 0) {
      console.log(`Deleting ${response.blobs.length} blobs...`);
      await del(response.blobs.map(b => b.url), { token: process.env.BLOB_READ_WRITE_TOKEN });
      count += response.blobs.length;
    }
    
    cursor = response.cursor;
  } while (cursor);
  
  console.log(`Successfully deleted ${count} blobs.`);
}

clearBlob().catch(console.error);
