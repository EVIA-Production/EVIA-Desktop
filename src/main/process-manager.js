// Process manager for EVIA Desktop
// Helps with starting/stopping and managing the Swift helper process

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");
import { PLATFORM } from "./platform";

class ProcessManager {
  constructor() {
    this.processes = {};
    this.stdoutBuffers = {};
  }

  /**
   * Start the macOS system audio helper
   * @returns {Promise<{ok: boolean, pid?: number, error?: string}>}
   */
  async startSystemAudioHelper() {
    if (PLATFORM !== "darwin") {
      return {
        ok: false,
        error: "System audio helper is only available on macOS",
      };
    }

    if (this.processes.systemAudio) {
      return { ok: true, pid: this.processes.systemAudio.pid };
    }

    try {
      // Kill any existing processes first
      await this.killExistingHelperProcesses();

      // Determine helper path
      const helperPath = this.getHelperPath();
      console.log(`Starting system audio helper at: ${helperPath}`);

      // Ensure helper exists
      if (!fs.existsSync(helperPath)) {
        throw new Error(`Helper binary not found at: ${helperPath}`);
      }

      // Spawn process with stdio configuration
      const proc = spawn(helperPath, [], { stdio: ["ignore", "pipe", "pipe"] });
      this.processes.systemAudio = proc;
      this.stdoutBuffers.systemAudio = "";

      // Setup error handler
      proc.on("error", (err) => {
        console.error(`SystemAudioCapture process error:`, err);
        delete this.processes.systemAudio;
        delete this.stdoutBuffers.systemAudio;
      });

      // Setup exit handler
      proc.on("exit", (code) => {
        console.log(`SystemAudioCapture process exited with code: ${code}`);
        delete this.processes.systemAudio;
        delete this.stdoutBuffers.systemAudio;
      });

      return { ok: true, pid: proc.pid };
    } catch (error) {
      console.error("Failed to start system audio helper:", error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Stop the system audio helper
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async stopSystemAudioHelper() {
    if (!this.processes.systemAudio) {
      return { ok: true };
    }

    try {
      // Send SIGTERM to process
      this.processes.systemAudio.kill("SIGTERM");

      // Wait for process to exit
      await new Promise((resolve) => {
        const proc = this.processes.systemAudio;

        // If process already exited
        if (!proc || proc.exitCode !== null) {
          delete this.processes.systemAudio;
          delete this.stdoutBuffers.systemAudio;
          return resolve();
        }

        // Otherwise wait for exit
        proc.once("exit", () => {
          delete this.processes.systemAudio;
          delete this.stdoutBuffers.systemAudio;
          resolve();
        });

        // Force kill after timeout
        setTimeout(() => {
          try {
            if (proc && proc.exitCode === null) {
              proc.kill("SIGKILL");
            }
          } catch (e) {
            console.warn("Error force killing process:", e);
          }
          resolve();
        }, 2000);
      });

      return { ok: true };
    } catch (error) {
      console.error("Error stopping system audio helper:", error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Kill any existing helper processes (useful during development)
   */
  async killExistingHelperProcesses() {
    if (PLATFORM !== "darwin") {
      return;
    }

    try {
      console.log("Killing any existing SystemAudioCapture processes...");
      spawn("pkill", ["-f", "SystemAudioCapture"], { stdio: "ignore" });

      // Give time for processes to terminate
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.warn("Error killing existing processes:", error);
    }
  }

  /**
   * Get the path to the system audio helper binary
   * @returns {string} Path to the helper binary
   */
  getHelperPath() {
    if (!app.isPackaged) {
      // Dev paths...
      const devPath = path.join(
        __dirname,
        "../../native/mac/SystemAudioCapture/.build/debug/SystemAudioCapture"
      );

      if (fs.existsSync(devPath)) {
        return devPath;
      }

      // Fallback to alternate debug path
      const altDevPath = path.join(
        __dirname,
        "../../native/mac/SystemAudioCapture/SystemAudioCapture.app/Contents/MacOS/SystemAudioCapture"
      );

      if (fs.existsSync(altDevPath)) {
        return altDevPath;
      }
    } else {
      const prodPath = path.join(
        process.resourcesPath,
        "mac",
        "SystemAudioCapture.app/Contents/MacOS/SystemAudioCapture"
      );
      console.log(
        `[SystemAudioCapture] Using bundled production path: ${prodPath}`
      );
      return prodPath;
    }
  }

  /**
   * Register output handlers for the system audio helper
   * @param {Function} stdoutHandler - Handler for stdout data
   * @param {Function} stderrHandler - Handler for stderr data
   * @returns {boolean} Whether the registration was successful
   */
  registerSystemAudioHandlers(stdoutHandler, stderrHandler) {
    if (!this.processes.systemAudio) {
      return false;
    }

    // Register stdout handler with line buffering
    this.processes.systemAudio.stdout.on("data", (chunk) => {
      console.log("[system-audio] stdout:", chunk.toString().trim());
      // Append to buffer
      this.stdoutBuffers.systemAudio += chunk.toString("utf8");

      // Process complete lines
      let newlineIndex;
      while (
        (newlineIndex = this.stdoutBuffers.systemAudio.indexOf("\n")) !== -1
      ) {
        const line = this.stdoutBuffers.systemAudio
          .slice(0, newlineIndex)
          .trim();
        this.stdoutBuffers.systemAudio = this.stdoutBuffers.systemAudio.slice(
          newlineIndex + 1
        );

        if (line.length > 0) {
          stdoutHandler(line);
        }
      }
    });

    // Register stderr handler
    if (stderrHandler) {
      this.processes.systemAudio.stderr.on("data", (data) => {
        console.log("[system-audio] stderr:", data.toString().trim());
        stderrHandler(data.toString("utf8").trim());
      });
    }

    this.processes.systemAudio.on("spawn", () => {
      console.log("[system-audio] Helper spawned successfully");
    });
    this.processes.systemAudio.on("error", (err) => {
      console.error("[system-audio] Helper error:", err);
    });
    this.processes.systemAudio.on("exit", (code) => {
      console.log("[system-audio] Helper exited with code", code);
    });

    return true;
  }

  /**
   * Clean up all processes when application exits
   */
  cleanupAllProcesses() {
    console.log("Cleaning up all processes...");

    Object.keys(this.processes).forEach((key) => {
      const proc = this.processes[key];
      if (proc && proc.exitCode === null) {
        try {
          proc.kill("SIGTERM");
        } catch (e) {
          console.warn(`Error terminating ${key} process:`, e);
        }
      }
    });
  }
}

module.exports = new ProcessManager();
