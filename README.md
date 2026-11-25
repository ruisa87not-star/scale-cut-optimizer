# Scale Cut Optimizer｜卷材裁切優化器

[English](#english)

Scale Cut Optimizer 是一款 Windows 卷材排料工具。輸入訂單、新卷長度和現有餘料，即可查看每卷的裁切配方、新卷用量及可回收餘料。

## 下載

[下載 Windows x64 便攜版 v1.7.0](https://github.com/ruisa87not-star/scale-cut-optimizer/releases/download/v1.7.0/Cutting-Stock-Optimizer-1.7.0.exe) · [查看所有版本](https://github.com/ruisa87not-star/scale-cut-optimizer/releases)

下載後直接執行 `.exe` 即可使用。介面及 Excel 報表支援繁體中文與英文。

## 快速開始

1. 設定新卷長度與可回收門檻。相同長度的餘料可按數量批量新增。
2. 輸入訂單，每行一組 `長度,數量`，例如 `1000,3`。也可匯入 `.txt`、`.csv` 或 `.xlsx`。
3. 計算後查看逐卷裁切明細，並匯出 Excel 報表。報表包含裁切配方、視覺排料與實際裁切數量。

一般裁切優先減少新卷用量及不可回收碎料，也支援固定節距與相容端段對接。請在同一份訂單中使用一致的長度單位。

## 原始碼與開發

桌面版以 Electron 封裝 React 介面，使用 C++17 引擎計算排料。Windows 建置需要 Node.js、pnpm，以及含 C++ 工作負載的 Visual Studio 2022 Build Tools。

- [桌面版開發文件](desktop-react-cpp/README.md) 包含執行、打包、匯入格式及裁切規則。
- [舊版 Python 腳本](scale_calculator_v2.0.6.py) 是原有的獨立版本。

## English

Scale Cut Optimizer is a Windows desktop app for planning cuts from rolls of material. Enter order lengths and quantities, the length of a new roll, and any offcuts you have in stock. The app shows what to cut from each roll, how many new rolls to open, and which offcuts can be reused.

[Download the Windows x64 portable app (v1.7.0)](https://github.com/ruisa87not-star/scale-cut-optimizer/releases/download/v1.7.0/Cutting-Stock-Optimizer-1.7.0.exe). Run the downloaded `.exe` to get started. The interface and Excel reports are available in English and Traditional Chinese.

### Quick start

1. Set the new roll length and the minimum reusable offcut length. You can add multiple offcuts of the same length at once.
2. Enter one `length,quantity` pair per line, such as `1000,3`, or import a `.txt`, `.csv`, or `.xlsx` file.
3. Calculate the plan, review the cuts for each roll, and export an Excel workbook with cut recipes, a visual layout, and actual cut counts.

The optimizer supports fixed-pitch cutting and joins between compatible end segments. Use the same length unit throughout an order.

The desktop app uses Electron, React, and a C++17 optimization engine. For Windows build and packaging instructions, see the [desktop documentation (Traditional Chinese)](desktop-react-cpp/README.md).
