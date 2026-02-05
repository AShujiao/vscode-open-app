using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

class Program {
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    static extern IntPtr GetShellWindow();

    [DllImport("user32.dll", SetLastError = true)]
    static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    const int SW_RESTORE = 9;
    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x00000080;
    const int WS_EX_APPWINDOW = 0x00040000;

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    static void Main(string[] args) {
        Console.OutputEncoding = Encoding.UTF8; // Fix encoding issue
        
        if (args.Length == 0) {
            Console.WriteLine("Usage: WindowActivator.exe [list | activate <hwnd>]");
            return;
        }

        string command = args[0].ToLower();

        if (command == "list") {
            ListWindows();
        } else if (command == "activate" && args.Length > 1) {
            long hwndLong;
            if (long.TryParse(args[1], out hwndLong)) {
                ActivateWindow((IntPtr)hwndLong);
            } else {
                Console.WriteLine("Invalid window handle.");
            }
        }
    }

    static void ActivateWindow(IntPtr hWnd) {
        // Force restore if minimized
        if (IsIconic(hWnd)) {
            ShowWindow(hWnd, SW_RESTORE);
        }
        
        // Try multiple methods to bring to front
        SetForegroundWindow(hWnd);
        
        // Allow time for Windows to process
        // Sometimes a second call helps if the first one was ignored due to focus stealing prevention
        SetForegroundWindow(hWnd); 
        
        Console.WriteLine("Done");
    }

    static void ListWindows() {
        IntPtr shellWindow = GetShellWindow();
        List<string> results = new List<string>();

        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (hWnd == shellWindow) return true;
            if (!IsWindowVisible(hWnd)) return true;

            int length = GetWindowTextLength(hWnd);
            if (length == 0) return true;

            StringBuilder builder = new StringBuilder(length + 1);
            GetWindowText(hWnd, builder, builder.Capacity);
            string title = builder.ToString();

            int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
            bool isToolWindow = (exStyle & WS_EX_TOOLWINDOW) != 0;
            bool isAppWindow = (exStyle & WS_EX_APPWINDOW) != 0;

            if (isToolWindow && !isAppWindow) return true;

            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            string processName = "";
            string processPath = "";

            try {
                Process p = Process.GetProcessById((int)pid);
                processName = p.ProcessName;
                try {
                    processPath = p.MainModule.FileName;
                } catch {
                    // Ignore permission errors
                }
            } catch {
                // Ignore exited processes
            }

            string safeTitle = title.Replace("|", " ");
            results.Add(string.Format("{0}|{1}|{2}|{3}|{4}", hWnd, pid, safeTitle, processName, processPath));

            return true;
        }, IntPtr.Zero);

        foreach (string line in results) {
            Console.WriteLine(line);
        }
    }
}
