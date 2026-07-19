using System;
using System.Collections.Concurrent;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Canon.Eos.Framework;
using Canon.Eos.Framework.Internal.SDK;

namespace CanonHelper
{
    class Program
    {
        private static EosFramework _framework;
        private static EosCamera _camera;
        private static IntPtr _cameraRef;
        private static string _liveViewPath = null;
        private static bool _liveViewRunning = false;
        private static bool _liveViewTftMode = false;
        private static System.Windows.Forms.Timer _liveViewTimer = null;
        private static ConcurrentQueue<string> _commandQueue = new ConcurrentQueue<string>();
        private static readonly object _cameraLock = new object();
        private static bool _exitRequested = false;

        [STAThread]
        static void Main(string[] args)
        {
            var stdout = new StreamWriter(Console.OpenStandardOutput());
            stdout.AutoFlush = true;
            Console.SetOut(stdout);

            // Parse arguments
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--live-view" && i + 1 < args.Length)
                {
                    _liveViewPath = args[i + 1];
                }
            }

            Console.WriteLine("STATUS:INITIALIZING");

            try
            {
                _framework = new EosFramework();
                var cameras = _framework.GetCameraCollection();
                if (cameras.Count == 0)
                {
                    Console.WriteLine("ERROR:No cameras found");
                    return;
                }

                _camera = cameras[0];
                
                // Get native camera handle via reflection
                var handleField = typeof(EosObject).GetField("_handle", BindingFlags.NonPublic | BindingFlags.Instance);
                if (handleField == null)
                {
                    Console.WriteLine("ERROR:Could not find camera handle");
                    return;
                }
                _cameraRef = (IntPtr)handleField.GetValue(_camera);

                // Set SaveTo to Camera-only (1) so the photo is reliably written to the SD card.
                try
                {
                    _camera.SetProperty(0x00000010, 1);
                }
                catch (Exception ex)
                {
                    Console.WriteLine("WARNING:Failed to set SaveTo property - " + ex.Message);
                }

                Console.WriteLine("STATUS:CONNECTED:" + _camera.DeviceDescription);

                // Live View path configured
                if (!string.IsNullOrEmpty(_liveViewPath))
                {
                    Console.WriteLine("STATUS:LV_PATH_CONFIGURED");
                }

                // Start Stdin background thread
                Thread stdinThread = new Thread(StdinReadLoop);
                stdinThread.IsBackground = true;
                stdinThread.Start();

                // Initialize Live View Timer (ticks on the main STA thread)
                _liveViewTimer = new System.Windows.Forms.Timer();
                _liveViewTimer.Interval = 30; // 30ms (~33 FPS) for smooth updates
                _liveViewTimer.Tick += LiveViewTimer_Tick;

                // Main loop processing COM and stdin commands
                while (!_exitRequested)
                {
                    // Process COM messages and WinForms messages on main STA thread
                    Application.DoEvents();

                    string command;
                    if (_commandQueue.TryDequeue(out command))
                    {
                        ExecuteCommand(command);
                    }

                    Thread.Sleep(10);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERROR:" + ex.Message);
            }
            finally
            {
                Shutdown();
            }
        }

        private static void StdinReadLoop()
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (!string.IsNullOrEmpty(line))
                    {
                        _commandQueue.Enqueue(line);
                    }
                }
                _exitRequested = true;
            }
            catch 
            {
                _exitRequested = true;
            }
        }

        private static void ExecuteCommand(string line)
        {
            try
            {
                if (line.Equals("EXIT", StringComparison.OrdinalIgnoreCase) || line.Equals("STOP", StringComparison.OrdinalIgnoreCase))
                {
                    _exitRequested = true;
                    return;
                }
                else if (line.StartsWith("CAPTURE ", StringComparison.OrdinalIgnoreCase))
                {
                    string outputPath = line.Substring(8).Trim();
                    HandleCapture(outputPath);
                }
                else if (line.Equals("START_LV", StringComparison.OrdinalIgnoreCase))
                {
                    HandleStartLiveView();
                }
                else if (line.Equals("START_LV_TFT", StringComparison.OrdinalIgnoreCase))
                {
                    HandleStartLiveViewTft();
                }
                else if (line.Equals("STOP_LV", StringComparison.OrdinalIgnoreCase))
                {
                    HandleStopLiveView();
                }
                else if (line.Equals("START_POLLING", StringComparison.OrdinalIgnoreCase))
                {
                    HandleStartPolling();
                }
                else if (line.Equals("STOP_POLLING", StringComparison.OrdinalIgnoreCase))
                {
                    HandleStopPolling();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERROR:Command execution failed - " + ex.Message);
            }
        }

        private static void LiveViewTimer_Tick(object sender, EventArgs e)
        {
            if (!_liveViewRunning) return;

            try
            {
                byte[] imageBytes = null;
                lock (_cameraLock)
                {
                    if (_liveViewRunning)
                    {
                        imageBytes = _camera.GetLiveViewImage();
                    }
                }

                if (imageBytes != null && imageBytes.Length > 100)
                {
                    // Write to a temporary file, then copy to target to prevent Electron file reading collision
                    string tempPath = _liveViewPath + ".tmp";
                    File.WriteAllBytes(tempPath, imageBytes);
                    if (File.Exists(_liveViewPath))
                    {
                        File.Delete(_liveViewPath);
                    }
                    File.Move(tempPath, _liveViewPath);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("LV_ERROR:" + ex.Message);
            }
        }

        private static void HandleStartLiveView()
        {
            lock (_cameraLock)
            {
                if (_liveViewRunning) return;

                int retries = 5;
                for (int i = 1; i <= retries; i++)
                {
                    try
                    {
                        _camera.IsInLiveViewMode = true;
                        System.Threading.Thread.Sleep(500);
                        _camera.StartLiveView(true); // Always tft=true
                        System.Threading.Thread.Sleep(800);
                        _camera.LiveViewDevice = (EosLiveViewDevice)3; // Always Both
                        _liveViewRunning = true;
                        _liveViewTftMode = true;
                        if (!string.IsNullOrEmpty(_liveViewPath))
                        {
                            _liveViewTimer.Start();
                        }
                        Console.WriteLine("STATUS:LV_STARTED");
                        return; // Success
                    }
                    catch (Exception ex)
                    {
                        if (i == retries)
                        {
                            Console.WriteLine("ERROR:StartLiveView failed - " + ex.Message);
                        }
                        else
                        {
                            Console.WriteLine("WARNING:StartLiveView attempt " + i + " failed (" + ex.Message + "). Retrying in 500ms...");
                            System.Threading.Thread.Sleep(500);
                        }
                    }
                }
            }
        }

        private static void HandleStartLiveViewTft()
        {
            lock (_cameraLock)
            {
                if (_liveViewRunning) return;

                int retries = 5;
                for (int i = 1; i <= retries; i++)
                {
                    try
                    {
                        _camera.IsInLiveViewMode = true;
                        System.Threading.Thread.Sleep(500);
                        _camera.StartLiveView(true);
                        System.Threading.Thread.Sleep(800);
                        _camera.LiveViewDevice = (EosLiveViewDevice)3; // Both first to force mirror-up
                        System.Threading.Thread.Sleep(500);
                        _camera.LiveViewDevice = (EosLiveViewDevice)1; // Switch to Camera-only (TFT/HDMI) to prevent USB stalling
                        _liveViewRunning = true;
                        _liveViewTftMode = true;
                        // Do NOT start _liveViewTimer automatically here in TFT mode,
                        // to avoid locking or lagging the HDMI live preview stream.
                        Console.WriteLine("STATUS:LV_STARTED_TFT");
                        return; // Success
                    }
                    catch (Exception ex)
                    {
                        if (i == retries)
                        {
                            Console.WriteLine("ERROR:StartLiveViewTft failed - " + ex.Message);
                        }
                        else
                        {
                            Console.WriteLine("WARNING:StartLiveViewTft attempt " + i + " failed (" + ex.Message + "). Retrying in 500ms...");
                            System.Threading.Thread.Sleep(500);
                        }
                    }
                }
            }
        }

        private static void HandleStopLiveView()
        {
            lock (_cameraLock)
            {
                try
                {
                    if (_liveViewRunning)
                    {
                        _liveViewRunning = false;
                        if (_liveViewTimer != null)
                        {
                            _liveViewTimer.Stop();
                        }
                        _camera.StopLiveView();
                        _camera.IsInLiveViewMode = false;
                        _liveViewTftMode = false;
                        Console.WriteLine("STATUS:LV_STOPPED");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("ERROR:StopLiveView failed - " + ex.Message);
                }
            }
        }

        private static void HandleStartPolling()
        {
            lock (_cameraLock)
            {
                if (_liveViewTimer != null && !string.IsNullOrEmpty(_liveViewPath))
                {
                    _camera.LiveViewDevice = (EosLiveViewDevice)3; // Switch to Both so host can poll frames
                    System.Threading.Thread.Sleep(200);
                    _liveViewTimer.Start();
                    Console.WriteLine("STATUS:POLLING_STARTED");
                }
            }
        }

        private static void HandleStopPolling()
        {
            lock (_cameraLock)
            {
                if (_liveViewTimer != null)
                {
                    _liveViewTimer.Stop();
                    _camera.LiveViewDevice = (EosLiveViewDevice)1; // Switch back to Camera-only (TFT/HDMI)
                    Console.WriteLine("STATUS:POLLING_STOPPED");
                }
            }
        }

        private static void HandleCapture(string outputPath)
        {
            bool wasLiveViewRunning = false;
            lock (_cameraLock)
            {
                wasLiveViewRunning = _liveViewRunning;
            }

            try
            {
                // 1. Suspend live view if running
                if (wasLiveViewRunning)
                {
                    lock (_cameraLock)
                    {
                        _liveViewRunning = false;
                        if (_liveViewTimer != null)
                        {
                            _liveViewTimer.Stop();
                        }
                    }
                    
                    Thread.Sleep(100);

                    lock (_cameraLock)
                    {
                        try
                        {
                            _camera.StopLiveView();
                        }
                        catch {}
                    }
                    
                    // Settle time for cermin DSLR turun
                    Thread.Sleep(600);
                }

                lock (_cameraLock)
                {
                    // Get initial newest file on card
                    string initialNewestName = "";
                    ulong initialNewestSize = 0;
                    FindNewestFile(_cameraRef, ref initialNewestName, ref initialNewestSize);

                    // 2. Trigger shutter
                    try
                    {
                        _camera.TakePictureNoAf();
                    }
                    catch
                    {
                        _camera.TakePicture();
                    }

                    // 3. Poll for new photo on camera memory card
                    string currentNewestName = initialNewestName;
                    ulong currentNewestSize = 0;
                    IntPtr currentNewestRef = IntPtr.Zero;
                    bool found = false;

                    for (int attempt = 0; attempt < 50; attempt++)
                    {
                        EdsGetEvent_Pin();
                        Thread.Sleep(200);

                        string pollName = "";
                        ulong pollSize = 0;
                        IntPtr pollRef = FindNewestFile(_cameraRef, ref pollName, ref pollSize);

                        if (pollRef != IntPtr.Zero && pollName != "")
                        {
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
                        // 4. Download file
                        uint err = DownloadFile(currentNewestRef, currentNewestSize, outputPath);
                        if (err == 0)
                        {
                            Console.WriteLine("SUCCESS:" + outputPath);
                            // 5. Clean up card
                            EdsDeleteDirectoryItem(currentNewestRef);
                        }
                        else
                        {
                            Console.WriteLine("ERROR:Download failed (0x" + err.ToString("X") + ")");
                        }
                    }
                    else
                    {
                        Console.WriteLine("ERROR:Polling timed out. No new photo written to camera SD card.");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("ERROR:Capture exception - " + ex.Message);
            }
            finally
            {
                // 6. Resume live view if it was active
                if (wasLiveViewRunning)
                {
                    Thread.Sleep(300);
                    if (_liveViewTftMode)
                    {
                        HandleStartLiveViewTft();
                    }
                    else
                    {
                        HandleStartLiveView();
                    }
                }
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
            uint err = EdsCreateFileStream_Pin(destinationPath, 1, 2, out streamRef);
            if (err != 0) return err;

            try
            {
                err = EdsDownload_Pin(dirItemRef, size, streamRef);
                if (err != 0) return err;
                err = EdsDownloadComplete_Pin(dirItemRef);
                return err;
            }
            finally
            {
                if (streamRef != IntPtr.Zero) EdsRelease_Pin(streamRef);
            }
        }

        private static void Shutdown()
        {
            lock (_cameraLock)
            {
                _liveViewRunning = false;
            }
            if (_liveViewTimer != null)
            {
                try
                {
                    _liveViewTimer.Stop();
                    _liveViewTimer.Dispose();
                }
                catch {}
                _liveViewTimer = null;
            }

            lock (_cameraLock)
            {
                try
                {
                    if (_camera != null)
                    {
                        try { _camera.StopLiveView(); } catch {}
                        try { _camera.IsInLiveViewMode = false; } catch {}
                        _camera.Dispose();
                    }
                }
                catch {}
            }
            Console.WriteLine("STATUS:DISCONNECTED");
        }

        // P/Invokes
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

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsGetEvent")]
        private static extern uint EdsGetEvent_Pin();

        [System.Runtime.InteropServices.DllImport("EDSDK.dll", EntryPoint = "EdsDeleteDirectoryItem")]
        private static extern uint EdsDeleteDirectoryItem(IntPtr inDirItemRef);
    }
}
