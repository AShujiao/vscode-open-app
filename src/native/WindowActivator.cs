using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

class Program {
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hWnd);

    const int SW_RESTORE = 9;

    static void Main(string[] args) {
        if (args.Length == 0) return;
        string targetProcess = args[0]; // 例如 "notepad"

        foreach (var process in Process.GetProcessesByName(targetProcess)) {
            if (process.MainWindowHandle != IntPtr.Zero) {
                IntPtr hWnd = process.MainWindowHandle;

                // 如果窗口最小化，则还原
                if (IsIconic(hWnd)) {
                    ShowWindow(hWnd, SW_RESTORE);
                }

                SetForegroundWindow(hWnd);
                Console.WriteLine("Done");
                return;
            }
        }
    }
}
