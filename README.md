# ZRM Core v1.0 — Zero-dependency Router Monitor

ZRM (Zero-dependency Router Monitor) is a lightweight, ultra-fast command-line assistant designed to map natural language onto native system operations. Operating completely offline with localized **TensorFlow.js** inference, it eliminates the need for heavyweight tokenization frameworks or external cloud processing APIs, returning decisions under **15ms**.

---

## Technical Performance Architecture

*   **Zero External Dependencies**: Bypasses sprawling processing chains (`natural`, MongoDB client drivers, etc.).
*   **Custom Unicode Regex Tokenizer**: Native string splitting optimizing multi-language evaluation without allocating bulky model structures.
*   **Complete Privacy**: 100% on-device operations. Shell behaviors, paths, and metadata remain strictly contained.
*   **Dynamic Command Lifecycle Metric**: Time profiling tracks entire transactional cycles (Inference + Prompt Interaction + Physical OS execution times).

---

## Capabilities Ledger

| Action Intent | Scope of Execution | OS Adaptation |
| :--- | :--- | :--- |
| `sys_disk` | Read available block and partition allocations. | `wmic` (Win32) / `df` (Unix) |
| `sys_network` | Scan sockets listening for active loopback traffic. | `netstat` (Win32) / `ss` (Unix) |
| `file_create` | Generates files via atomic buffers or writes deep paths. | Unified System Call |
| `file_rename` | Transfers metadata indices to re-assign resource naming. | Unified System Call |
| `file_delete` | Recursive removal protocol backed by confirmation gates. | Native File Lock Safe |
| `process_kill` | Drops target sockets or app sequences (Port, PID, Name). | `taskkill` (Win32) / `pkill` (Unix) |
| `custom_command` | Unrestricted proxy execution layer into host Shell terminal. | Raw Runtime Passthrough |

---

## Configuration Strategy

To implement new training patterns or system directives, adjust the `dataset.json` map:

```json
{
  "labels": ["intent_name"],
  "trainingData": [
    { "text": "natural language query trigger", "label": "intent_name" }
  ],
  "actions": {
    "intent_name": {
      "win32": "powershell_or_cmd_sequence",
      "default": "bash_or_sh_sequence"
    }
  }
}
