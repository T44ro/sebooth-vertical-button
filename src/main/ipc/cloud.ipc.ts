import { ipcMain } from 'electron';
import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';
import { config } from 'dotenv';
import { uploadQueue } from '../services/UploadQueue';

// Load environment variables from .env
config();


// GCS Key Configuration
const gcsKeyName = process.env.GCS_KEY_PATH || 'google-key.json';
const keyPath = path.isAbsolute(gcsKeyName) 
  ? gcsKeyName 
  : path.join(process.cwd(), gcsKeyName);

let storage: Storage | null = null;

try {
  if (fs.existsSync(keyPath)) {
    storage = new Storage({ keyFilename: keyPath });
    console.log(`[Cloud Storage] Initialized successfully with: ${path.basename(keyPath)}`);
  } else {
    console.warn(`[Cloud Storage] Missing Google Cloud key at: ${keyPath}`);
    console.warn('[Cloud Storage] Please set GCS_KEY_PATH in .env or place google-key.json in the root.');
  }
} catch (error) {
  console.error('[Cloud Storage] Failed to initialize:', error);
}


// Background worker to retry failed uploads
setInterval(async () => {
  if (!storage) return;
  const pending = uploadQueue.getPendingQueue();
  if (pending.length === 0) return;

  console.log(`[Cloud Storage] Attempting to process offline queue (${pending.length} items)...`);
  
  for (const item of pending) {
    try {
      const bucket = storage.bucket(item.bucketName);
      if (!fs.existsSync(item.filePath)) {
         console.warn(`[Cloud Storage] Queue item file missing, removing from queue: ${item.filePath}`);
         uploadQueue.markSuccessful(item.id);
         continue;
      }

      await bucket.upload(item.filePath, {
        destination: item.destinationPath,
        metadata: { 
            contentType: item.mimeType,
            cacheControl: 'public, max-age=31536000' // Phase 2: Cache Control Header
        }
      });

      console.log(`[Cloud Storage] Successfully uploaded queued item: ${item.destinationPath}`);
      uploadQueue.markSuccessful(item.id);
    } catch (error) {
      console.error(`[Cloud Storage] Retry failed for ${item.destinationPath}`);
      uploadQueue.incrementRetry(item.id);
    }
  }
}, 10000); // Check every 10 seconds for fast offline recovery

export function registerCloudHandlers(): void {
  ipcMain.handle('cloud:upload-file', async (_, params: {
    bucketName: string;
    destinationPath: string; // e.g. sessionId/photo.png
    filePath?: string;
    base64Data?: string;
    mimeType: string;
  }) => {
    if (!storage) {
       return { success: false, error: 'Google Cloud API Key not found' };
    }
    
    // Generate Public URL (assuming the bucket has public read access)
    // We return this immediately so UI doesn't block if we must fallback to queue
    const publicUrl = `https://storage.googleapis.com/${params.bucketName}/${params.destinationPath}`;

    try {
      const bucket = storage.bucket(params.bucketName);
      const file = bucket.file(params.destinationPath);

      if (params.filePath) {
        if (!fs.existsSync(params.filePath)) {
           return { success: false, error: `File not found locally: ${params.filePath}` };
        }
        await bucket.upload(params.filePath, {
          destination: params.destinationPath,
          metadata: { 
              contentType: params.mimeType,
              cacheControl: 'public, max-age=31536000' // Phase 2: Cache Control Header
          }
        });
      } else if (params.base64Data) {
        const base64Content = params.base64Data.replace(/^data:([A-Za-z-+/]+);base64,/, '');
        const buffer = Buffer.from(base64Content, 'base64');
        await file.save(buffer, {
          metadata: { 
              contentType: params.mimeType,
              cacheControl: 'public, max-age=31536000' // Phase 2: Cache Control Header
          },
          resumable: false
        });
      } else {
        return { success: false, error: 'No data provided for upload (need filePath or base64Data)' };
      }

      return { success: true, url: publicUrl, status: 'uploaded' };

    } catch (error: any) {
      console.warn('[Cloud Storage] Upload failed, pushing to offline queue:', error.message);
      
      uploadQueue.enqueue({
        bucketName: params.bucketName,
        destinationPath: params.destinationPath,
        filePath: params.filePath || '',
        mimeType: params.mimeType
      }, params.base64Data);

      // Return success with 'queued' status so frontend proceeds to generate QR anyway
      return { success: true, url: publicUrl, status: 'queued', message: 'Saved offline, will sync when internet returns.' };
    }
  });

  ipcMain.handle('cloud:get-queue', () => {
    return { success: true, data: uploadQueue.getPendingQueue() };
  });
}
