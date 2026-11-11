# CLAUDART Insights

Dashboard và CLI chạy cục bộ để xem mức dùng [Claude Code](https://claude.com/claude-code) của chính bạn. Công cụ lưu trữ transcript mà Claude Code giữ trên máy (`~/.claude/projects`), nạp vào SQLite, tính token và chi phí, rồi hiển thị sáu màn hình: Tổng quan, Dự án, Phiên làm việc, Model & subagent, Effort và Hoạt động.

Không có gì rời khỏi máy bạn. Server chỉ lắng nghe trên `127.0.0.1`, server và trang web đều không gửi request ra ngoài.

English version: [README.md](README.md)

## Yêu cầu

Node.js 25 trở lên.

## Chạy lần đầu

```bash
git clone https://github.com/vankhaivn/claudart-insights.git
cd claudart-insights
make start
```

`make start` cài package, build dashboard và phục vụ tại <http://localhost:4310>. Mở trang sẽ quét transcript vào `data/`; nút Làm mới quét lại. Máy không có `make` thì chạy `npm install` rồi `npm start`.

## Lệnh dùng hằng ngày

| Target `make` | Lệnh npm / CLI tương ứng | Việc làm |
| --- | --- | --- |
| `make` | | Liệt kê các target |
| `make start` | `npm start` | Build và phục vụ dashboard |
| `make dev` | `npm run dev` | Như trên, có hot reload |
| `make scan` | `node bin/insights.mjs scan` | Lưu các dòng transcript mới và nạp vào |
| `make usage DAYS=30 BY=model` | `node bin/insights.mjs usage --days 30 --by model` | Token và chi phí trên terminal; `ARGS="..."` thêm option khác |
| `make prices` | `node bin/insights.mjs prices` | Đối chiếu bảng giá với bản ghi chi phí của Claude Code |

## CLI

```text
node bin/insights.mjs scan                  lưu trữ các dòng transcript mới và nạp vào database
node bin/insights.mjs show <session>:<line> in một bản ghi đã lưu
node bin/insights.mjs usage [--days n | --since d --until d] [--by day|model|effort|project|session|hour|tool|subagent]
                            [--project name] [--model family] [--effort level]
node bin/insights.mjs prices                bảng giá đối chiếu với bản ghi chi phí của Claude Code
node bin/insights.mjs serve [--port n]      dashboard đã build tại http://localhost:<port>
```

Các lệnh dạng danh sách nhận `--json`. Với cùng một khoảng ngày và bộ lọc, `usage` và dashboard cho cùng số tổng.

## Cấu hình (tuỳ chọn)

Sao chép `insights.config.example.json` thành `insights.config.json` ở thư mục gốc repo. Mọi key đều tuỳ chọn; biến `INSIGHTS_CONFIG` trỏ tới file config ở chỗ khác.

| Key | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `providers` | `{ "claude": { "transcripts": "~/.claude/projects" } }` | Các nguồn transcript cần đọc; hiện chỉ biết `claude`, tên khác sẽ báo lỗi |
| `data` | `data` | Nơi chứa archive và database, tính từ vị trí file config |
| `port` | `4310` | Cổng dashboard |
| `timeZone` | múi giờ của hệ thống | Quyết định request thuộc ngày và giờ nào |
| `prices` | `prices.md` trong repo | Bảng giá |

## Dữ liệu nằm ở đâu

```text
data/
├── archive/claude/   bản sao thư mục projects, chỉ thêm vào, số dòng cố định
└── usage.db          dựng lại từ archive mỗi khi schema đổi
```

Archive vẫn giữ transcript sau khi Claude Code xoá nó. `data/` bị Git bỏ qua; xoá `usage.db` lúc nào cũng được, lần quét sau sẽ dựng lại.

Dự án của một phiên là thư mục gần nhất, từ thư mục làm việc trở lên, có `.git`; không có thì lấy tên chính thư mục đó.

## Chi phí được tính thế nào

Claude Code ghi chi phí cho mỗi phiên; Insights dùng con số đó và chia cho các request của phiên theo token, tính giá của chính ngày hôm đó trong [prices.md](prices.md) (USD cho một triệu token, mỗi dòng ứng với một model và ngày bắt đầu hiệu lực). Phiên không có bản ghi chi phí được ước tính từ bảng giá và được đánh dấu. `prices` và báo cáo của lần quét cho biết chỗ số của Claude Code lệch bảng giá; hãy thêm dòng mới từ ngày giá đổi, đừng sửa dòng cũ.

## Phát triển

```bash
make test        # npm test
make check       # npm run check: kiểm tra kiểu cho dashboard
make build       # npm run build: dashboard/dist
```

Test chỉ dùng transcript tổng hợp trong thư mục tạm. [CONTRIBUTING.md](CONTRIBUTING.md) mô tả Issue, branch, commit và pull request; [CLAUDE.md](CLAUDE.md) hướng dẫn coding agent làm việc trên bản fork.

## Giấy phép

MIT
