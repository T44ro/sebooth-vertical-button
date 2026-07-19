using System;
using System.IO;
using System.Reflection;
using System.Threading;
using Canon.Eos.Framework;
using Canon.Eos.Framework.Internal.SDK;

namespace CanonCapture
{
    class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length < 1)
            {
                Console.WriteLine("Usage: CanonCapture.exe <output_jpg_path>");
                return;
            }

            string outputPath = args[0];

            try
            {
                using (var framework = new EosFramework())
                {
                    var cameras = framework.GetCameraCollection();
                    if (cameras.Count == 0)
                    {
                        Console.WriteLine("ERROR: No cameras found.");
                        return;
                    }

                    using (var camera = cameras[0])
                    {
                        // Get native camera handle via reflection
                        var handleField = typeof(EosObject).GetField("_handle", BindingFlags.NonPublic | BindingFlags.Instance);
                        if (handleField == null)
                        {
                            Console.WriteLine("ERROR: Could not find _handle.");
                            return;
                        }
                        IntPtr cameraRef = (IntPtr)handleField.GetValue(camera);

                        // Force SaveTo = Camera-only (1) so the photo is reliably written to the SD card.
                        camera.SavePicturesToCamera();

                        // 1. Find the newest file currently on the SD card before we take the photo.
                        string initialNewestName = "";
                        ulong initialNewestSize = 0;
                        IntPtr initialNewestRef = FindNewestFile(cameraRef, ref initialNewestName, ref initialNewestSize);

                        // Disable autofocus to ensure rapid shutter release
                        try
                        {
                            camera.DisableAutoFocus();
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine("Disable AF warning: " + ex.Message);
                        }

                        // 2. Trigger shutter
                        try
                        {
                            camera.TakePictureNoAf();
                        }
                        catch
                        {
                            try
                            {
                                camera.TakePicture();
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine("ERROR: Shutter trigger failed - " + ex.Message);
                                return;
                            }
                        }

                        // 3. Poll for the new file on the camera SD card
                        string currentNewestName = initialNewestName;
                        ulong currentNewestSize = 0;
                        IntPtr currentNewestRef = IntPtr.Zero;
                        bool found = false;

                        // Poll up to 50 times (10 seconds timeout)
                        for (int attempt = 0; attempt < 50; attempt++)
                        {
                            // We MUST call EdsGetEvent to let the Canon SDK process internal camera notifications 
                            // and refresh its directory cache. Without this, new files won't appear in child listings.
                            EdsGetEvent_Pin();
                            Thread.Sleep(200);

                            string pollName = "";
                            ulong pollSize = 0;
                            IntPtr pollRef = FindNewestFile(cameraRef, ref pollName, ref pollSize);

                            if (pollRef != IntPtr.Zero && pollName != "")
                            {
                                // Check if this is a new file (greater index/name than the pre-capture newest file)
                                if (initialNewestName == "" || IsNewerFile(pollName, initialNewestName))
                                {
                                    currentNewestName = pollName;
                                    currentNewestSize = pollSize;
                                    currentNewestRef = pollRef;
                                    found = true;
                                    break;
                                }
                            }
                        }

                        if (found)
                        {
                            // 4. Download file from camera SD card to the host PC
                            uint err = DownloadFile(currentNewestRef, currentNewestSize, outputPath);
                            if (err == 0)
                            {
                                Console.WriteLine("SUCCESS: " + outputPath);

                                // 5. Delete file from camera card to keep the SD card clean
                                EdsDeleteDirectoryItem(currentNewestRef);
                            }
                            else
                            {
                                Console.WriteLine("ERROR: Download failed with error code: 0x" + err.ToString("X"));
                            }
                        }
                        else
                        {
                            Console.WriteLine("ERROR: Polling timed out. No new file appeared on the camera SD card.");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERROR: " + ex.Message);
            }
        }

        private static IntPtr FindNewestFile(IntPtr cameraRef, ref string newestName, ref ulong newestSize)
        {
            IntPtr newestRef = IntPtr.Zero;

            int volumeCount = 0;
            uint err = EdsGetChildCount_Pin(cameraRef, out volumeCount);
            if (err != 0) return IntPtr.Zero;

            for (int i = 0; i < volumeCount; i++)
            {
                IntPtr volumeRef = IntPtr.Zero;
                err = EdsGetChildAtIndex_Pin(cameraRef, i, out volumeRef);
                if (err == 0 && volumeRef != IntPtr.Zero)
                {
                    FindNewestFileInternal(volumeRef, ref newestRef, ref newestName, ref newestSize);
                }
            }

            return newestRef;
        }

        private static void FindNewestFileInternal(IntPtr parentRef, ref IntPtr newestRef, ref string newestName, ref ulong newestSize)
        {
            int count = 0;
            uint err = EdsGetChildCount_Pin(parentRef, out count);
            if (err != 0) return;

            for (int i = 0; i < count; i++)
            {
                IntPtr childRef = IntPtr.Zero;
                err = EdsGetChildAtIndex_Pin(parentRef, i, out childRef);
                if (err == 0 && childRef != IntPtr.Zero)
                {
                    Edsdk.EdsDirectoryItemInfo info;
                    err = Edsdk.EdsGetDirectoryItemInfo(childRef, out info);
                    if (err == 0)
                    {
                        if (info.isFolder != 0)
                        {
                            FindNewestFileInternal(childRef, ref newestRef, ref newestName, ref newestSize);
                        }
                        else
                        {
                            if (IsNewerFile(info.szFileName, newestName))
                            {
                                newestName = info.szFileName;
                                newestSize = info.Size;
                                newestRef = childRef;
                            }
                        }
                    }
                }
            }
        }

        private static bool IsNewerFile(string current, string newest)
        {
            if (newest == "") return true;

            int curNum = ExtractNumber(current);
            int newNum = ExtractNumber(newest);
            if (curNum >= 0 && newNum >= 0)
            {
                return curNum > newNum;
            }

            return string.Compare(current, newest, StringComparison.OrdinalIgnoreCase) > 0;
        }

        private static int ExtractNumber(string filename)
        {
            try
            {
                string clean = "";
                foreach (char c in filename)
                {
                    if (char.IsDigit(c)) clean += c;
                }
                if (clean.Length > 0) return int.Parse(clean);
            }
            catch { }
            return -1;
        }

        private static uint DownloadFile(IntPtr dirItemRef, ulong size, string destinationPath)
        {
            IntPtr streamRef = IntPtr.Zero;

            // EdsCreateFileStream
            // EdsFileCreateDisposition.CreateAlways = 1
            // EdsAccess.ReadWrite = 2
            uint err = EdsCreateFileStream_Pin(destinationPath, 1, 2, out streamRef);
            if (err != 0)
            {
                return err;
            }

            try
            {
                // EdsDownload
                err = EdsDownload_Pin(dirItemRef, size, streamRef);
                if (err != 0)
                {
                    return err;
                }

                // EdsDownloadComplete
                err = EdsDownloadComplete_Pin(dirItemRef);
                return err;
            }
            finally
            {
                if (streamRef != IntPtr.Zero)
                {
                    EdsRelease_Pin(streamRef);
                }
            }
        }

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsGetChildCount")]
        private static extern uint EdsGetChildCount_Pin(IntPtr inParentRef, out int outCount);

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsGetChildAtIndex")]
        private static extern uint EdsGetChildAtIndex_Pin(IntPtr inParentRef, int inIndex, out IntPtr outChildRef);

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsCreateFileStream")]
        private static extern uint EdsCreateFileStream_Pin(string inFileName, uint inCreateDisposition, uint inDesiredAccess, out IntPtr outStream);

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsDownload")]
        private static extern uint EdsDownload_Pin(IntPtr inDirItemRef, ulong inReadSize, IntPtr outStream);

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsDownloadComplete")]
        private static extern uint EdsDownloadComplete_Pin(IntPtr inDirItemRef);

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsRelease")]
        private static extern uint EdsRelease_Pin(IntPtr inRef);

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsDeleteDirectoryItem")]
        private static extern uint EdsDeleteDirectoryItem(IntPtr inDirItemRef);

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsGetEvent")]
        private static extern uint EdsGetEvent_Pin();
    }
}
