using System;
using System.Threading;
using Canon.Eos.Framework;
using Canon.Eos.Framework.Eventing;

class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        try
        {
            using (var framework = new EosFramework())
            {
                var cameras = framework.GetCameraCollection();
                if (cameras.Count == 0)
                {
                    Console.WriteLine("===ERROR===No cameras found.");
                    return;
                }

                using (var camera = cameras[0])
                {
                    Console.WriteLine("===CONNECTED===" + camera.DeviceName);
                    
                    var captureDone = new ManualResetEvent(false);
                    
                    camera.PictureTaken += (sender, e) =>
                    {
                        Console.WriteLine("===EVENT_PictureTaken===" + e.ImageData.Length);
                        System.IO.File.WriteAllBytes("test_capture_cs.jpg", e.ImageData);
                        captureDone.Set();
                    };

                    camera.SavePicturesToHost(Environment.CurrentDirectory, Environment.CurrentDirectory);
                    
                    Console.WriteLine("===TRIGGERING===");
                    camera.TakePicture();
                    
                    if (captureDone.WaitOne(20000))
                    {
                        Console.WriteLine("===SUCCESS===");
                    }
                    else
                    {
                        Console.WriteLine("===TIMEOUT===");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("===EXCEPTION===" + ex.Message);
        }
    }
}
