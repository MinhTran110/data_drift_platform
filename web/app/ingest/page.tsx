"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Upload, FileSpreadsheet, Database, CheckCircle, ArrowRight, Copy, Terminal } from "lucide-react";

export default function IngestPage() {
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [selectedAdapter, setSelectedAdapter] = useState("crm_sample");
  const [fileName, setFileName] = useState("");

  const curlExample = `curl -X POST "http://localhost:8000/ingest/file?filename=${fileName || "crm_sales.csv"}&adapter_name=${selectedAdapter}" \\
  -H "Content-Type: text/csv" \\
  --data-binary @${fileName || "crm_sales.csv"}`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileName(e.target.files[0].name);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-600">
          <span>Data Ingestion &amp; Adapter Layer</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Trung Tâm Nạp &amp; Chuẩn Hóa Dữ Liệu Đa Nguồn
        </h1>
        <p className="mt-2 text-sm text-slate-600 max-w-3xl">
          Nạp dữ liệu từ các nguồn bất kỳ (file CSV/Excel từ phòng ban, bảng cơ sở dữ liệu SQL, hoặc gửi qua API). 
          Hệ thống sẽ tự động đổi tên cột, tính toán thuộc tính phái sinh, chuẩn hóa nhãn phân loại, 
          chấm điểm mô hình Champion và phân vùng Parquet chuẩn Hive để phát hiện Drift.
        </p>
      </div>

      {/* 3 Quick Cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-900">File CSV &amp; Excel</h3>
          <p className="mt-1 text-xs text-slate-500">
            Kéo thả hoặc truyền file có định dạng cột tiếng Việt hoặc mã cũ. Adapter tự động chuẩn hóa về features.json.
          </p>
          <div className="mt-3 flex items-center text-xs font-medium text-blue-600">
            <span>Hỗ trợ .csv, .tsv, .xlsx, .parquet</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Database className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-900">Cơ Sở Dữ Liệu SQL</h3>
          <p className="mt-1 text-xs text-slate-500">
            Truy vấn theo cửa sổ thời gian (Windowing) từ PostgreSQL, MySQL, SQLite. Không làm nghẽn Database giao dịch.
          </p>
          <div className="mt-3 flex items-center text-xs font-medium text-emerald-600">
            <span>Cơ chế Watermark chống đọc lặp</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
            <Terminal className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-900">FastAPI Swagger UI</h3>
          <p className="mt-1 text-xs text-slate-500">
            Giao diện trực quan kiểm thử trực tiếp trên trình duyệt tại port :8000/docs. Thao tác click là chạy.
          </p>
          <div className="mt-3 flex items-center text-xs font-medium text-purple-600">
            <a href="http://localhost:8000/docs" target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1">
              Mở Swagger Docs (:8000) <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Main Interactive Ingestion Form */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left: Drag & Drop Ingestion Box */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">1. Tải Lên &amp; Nạp Dữ Liệu Mẻ (Batch Upload)</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              Local / API
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Chọn Cấu Hình Ánh Xạ (Adapter Mapping Template)
            </label>
            <select
              value={selectedAdapter}
              onChange={(e) => setSelectedAdapter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="crm_sample">CRM Sales System (crm_sample.yaml) - Tên cột tiếng Việt, tuổi, lương</option>
              <option value="database_sample">Core Banking DB (database_sample.yaml) - SQL extraction</option>
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              File cấu hình nằm tại: <code className="text-blue-600 font-mono">config/adapters/{selectedAdapter}.yaml</code>
            </p>
          </div>

          {/* Drag & Drop Area */}
          <div className="relative rounded-xl border-2 border-dashed border-slate-300 p-8 text-center hover:border-blue-500 transition-colors bg-slate-50/50">
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.parquet,.json"
              onChange={handleFileChange}
              className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
            />
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                <Upload className="h-6 w-6" />
              </div>
              <p className="text-xs font-medium text-slate-700">
                Kéo thả file vào đây hoặc <span className="text-blue-600 underline">Chọn file từ máy</span>
              </p>
              <p className="text-[11px] text-slate-400">
                Hỗ trợ CSV, Excel (.xlsx), Parquet dung lượng tối đa 100MB
              </p>
            </div>
          </div>

          {fileName && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-800">Đã chọn file: {fileName}</span>
              </div>
              <span className="text-[11px] text-emerald-600 font-semibold">Sẵn sàng nạp</span>
            </div>
          )}

          <div className="pt-2">
            <p className="text-xs text-slate-600">
              💡 <strong>Cách nạp ngay:</strong> Bạn có thể dùng lệnh CLI hoặc gửi file trực tiếp qua FastAPI endpoint bên phải.
            </p>
          </div>
        </div>

        {/* Right: API & CLI Ingestion Guide */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">2. Lệnh Nạp Tự Động (FastAPI &amp; CLI)</h2>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              Swagger Docs
            </span>
          </div>

          <div className="space-y-4">
            {/* FastAPI Interactive UI */}
            <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
              <h4 className="text-xs font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
                Giao Diện Trực Quan Swagger UI (:8000/docs)
              </h4>
              <p className="text-xs text-slate-600 mb-2">
                FastAPI cung cấp sẵn trang web tương tác để bạn test nạp file trực tiếp:
              </p>
              <ul className="text-xs text-slate-600 space-y-1 font-mono list-disc list-inside">
                <li><strong className="text-blue-700">POST /ingest/file</strong>: Tải file nhị phân trực tiếp</li>
                <li><strong className="text-blue-700">POST /ingest/path</strong>: Nạp file theo đường dẫn trên máy</li>
                <li><strong className="text-blue-700">POST /ingest/batch</strong>: Nạp mảng JSON thô</li>
                <li><strong className="text-blue-700">GET /ingest/adapters</strong>: Xem danh sách cấu hình mapping</li>
              </ul>
            </div>

            {/* cURL Command Snippet */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-slate-700">Lệnh cURL (Tải file lên API):</span>
                <button
                  onClick={() => copyToClipboard(curlExample)}
                  className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800"
                >
                  <Copy className="h-3 w-3" />
                  {copiedCurl ? "Đã chép!" : "Sao chép"}
                </button>
              </div>
              <pre className="rounded-lg bg-slate-900 p-3 text-[11px] text-emerald-400 font-mono overflow-x-auto">
                {curlExample}
              </pre>
            </div>

            {/* CLI Command Snippet */}
            <div>
              <span className="text-xs font-semibold text-slate-700 mb-1 block">Lệnh CLI (Chạy bằng Terminal):</span>
              <pre className="rounded-lg bg-slate-900 p-3 text-[11px] text-amber-300 font-mono overflow-x-auto">
{`python3 -m worker.adapter \\
  --source "data/incoming/crm_sales_october.csv" \\
  --config "config/adapters/crm_sample.yaml" \\
  --score`}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Workflow Explanation Banner */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5">
        <h3 className="text-sm font-bold text-blue-900 mb-2">
          🔄 Dữ liệu sau khi nạp sẽ đi về đâu?
        </h3>
        <p className="text-xs text-blue-800 leading-relaxed">
          Ngay sau khi bạn nạp file hoặc gọi API, Adapter sẽ lưu các bản ghi đã chuẩn hóa vào thư mục phân vùng{' '}
          <code className="font-mono bg-blue-100 px-1 py-0.5 rounded text-blue-900">inference_logs/year=.../hour=.../</code>.{' '}
          Bạn chỉ cần chạy <code className="font-mono bg-blue-100 px-1 py-0.5 rounded text-blue-900">make worker-run</code> (hoặc đợi GitHub Actions chạy theo chu kỳ 6h), 
          Worker sẽ tự động quét mẻ dữ liệu này, tính toán chỉ số <strong>PSI, KS-Test, Chi-Square</strong> và đẩy số liệu lên{' '}
          <Link href="/dashboard" className="font-semibold underline text-blue-950 hover:text-blue-700">
            Trang Dashboard
          </Link>{' '}
          đồng thời bắn cảnh báo vào <strong>Telegram Bot</strong> của bạn!
        </p>
      </div>
    </div>
  );
}
