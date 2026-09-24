# Stage 7 — Result UI

Stage 7 cung cấp giao diện chỉ đọc kết quả đối chiếu đã được lưu sau Stage 6. Mở trang kết quả không tự parse file và không tự chạy Matching Engine.

## API

`GET /api/batches/:batchId/results?page=1&pageSize=20&status=MATCHED&group=success`

- `page` mặc định là `1`.
- `pageSize` mặc định là `20`; chỉ chấp nhận `20`, `50` hoặc `100`.
- `status` chỉ chấp nhận một trong năm Matching Status.
- `group` là bộ lọc trình bày `success`, `warning` hoặc `error`; không dùng cùng lúc với `status` từ giao diện.
- Summary luôn được tính từ toàn bộ Master Orders của Batch trong PostgreSQL, không phải từ trang đang xem hay dữ liệu frontend.

API trả metadata Batch, summary tổng file/đơn/thành công/cảnh báo/lỗi, số lượng theo Matching Status, Orders đã phân trang và metadata phân trang. Endpoint là read-only và không gọi Matching Engine.

## Mapping hiển thị

| Matching Status | Nhãn UI | Nhóm UI |
| --- | --- | --- |
| `MATCHED` | Đã đối chiếu | Thành công |
| `PDF_NOT_FOUND` | Không thấy trong PDF | Cảnh báo |
| `EXCEL_NOT_FOUND` | Không thấy trong Excel | Cảnh báo |
| `DUPLICATE` | Trùng mã đơn | Lỗi |
| `PARSE_ERROR` | Lỗi đọc dữ liệu | Lỗi |

Route web là `/batches/[batchId]/results`. Filter, page và page size được giữ trong URL để có thể refresh, chia sẻ link và dùng nút Back của browser.

`sourceRefs` chỉ được dùng để hiển thị chỉ báo nguồn Excel/PDF (dòng hoặc trang khi có). UI không hiển thị đường dẫn storage hoặc raw file payload. Giá trị database `NULL` được hiển thị là `—`, không biến thành `0`.

## States và giới hạn

- Loading: hiển thị `Đang tải kết quả...`.
- Batch không tồn tại: hiển thị trạng thái riêng, không crash trang.
- Batch chưa matching: hiển thị `Batch này chưa có kết quả đối chiếu.`
- Filter rỗng và API lỗi có trạng thái riêng.

Stage 7 không có Error Detail (Stage 8), History, Export hay Authentication. UI không thiết lập field-source priority và không thay đổi business rule của Matching Engine.
