# Spaced Repetition Calendar

Ứng dụng lịch học theo phương pháp Spaced Repetition — Angular + Supabase.

## Tech stack

| Layer | Choice | Ghi chú |
|-------|--------|---------|
| Frontend | Angular 21 | Standalone components, signals |
| Calendar | FullCalendar 6.1.21 | Tham khảo từ clinic-ui |
| Styling | SCSS | Custom UI, không phụ thuộc theme nặng |
| Backend | Supabase | PostgreSQL + Auth + RLS |
| Client SDK | `@supabase/supabase-js` | Source of truth |
| Hosting | Vercel | SPA static build |

## Bắt đầu

### 1. Supabase

1. Tạo project trên [Supabase](https://supabase.com)
2. Chạy migration: `supabase/migrations/001_initial_schema.sql`
3. (Tuỳ chọn) Tạo admin thủ công:

```sql
update public.profiles set role = 'ADMIN' where email = 'your@email.com';
```

### 2. Environment

Cập nhật `src/environments/environment.ts` và `environment.prod.ts`:

```ts
supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
supabaseAnonKey: 'YOUR_ANON_KEY',
```

Hoặc set trên Vercel:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

(rồi map vào environment khi build nếu cần)

### 3. Chạy local

```bash
npm install
npm start
```

Mở http://localhost:4200

### 4. Deploy Vercel

```bash
npm run build
```

- Output: `dist/spaced-repetition-calender/browser`
- `vercel.json` đã cấu hình SPA rewrite

## Tính năng

- Click ngày trên Calendar → tạo Topic
- Tự động tạo lịch ôn: N+1, N+3, N+7, N+14, N+30, N+60
- Complete review, chỉnh schedule, thêm/replace/xóa future steps
- Role `USER` / `ADMIN` với RLS trên Supabase
- Admin: search user, mở calendar từng user

## Database

| Bảng | Mô tả |
|------|-------|
| `profiles` | Auto-create khi signup (trigger), `role` default `USER` |
| `study_topics` | Topic học: `title`, `study_date`, `description`, `subject`, `resource_url` |
| `study_reviews` | Schedule động per topic: `step_order`, `day_offset`, `review_date`, `status` |

**Constraints:**
- `unique (topic_id, day_offset)` — không trùng offset trong cùng Topic
- `day_offset > 0` — review steps only (STUDY nằm ở `study_topics.study_date`)
- RLS bắt buộc: USER chỉ CRUD `user_id = auth.uid()`, ADMIN full quyền

**Default schedule** (chỉ khi tạo Topic mới):
```ts
DEFAULT_SPACED_REPETITION_INTERVALS = [1, 3, 7, 14, 30, 60]
```
Mỗi Topic có thể có schedule khác (thêm/replace/delete future steps).

## Business rules

- Không tạo review date trong quá khứ
- Không duplicate `day_offset` per topic — `"N+30 already exists in this review schedule."`
- Không sửa/xóa completed review (DB trigger + RLS)
- Offset mới phải > Current Step
- Add/Replace/Delete dùng PostgreSQL RPC atomic (`003_study_review_rpc.sql`)
- Sau Add/Delete, `step_order` tự reorder theo `day_offset` (1, 2, 3, …)
- USER không được tự update `role` (RLS + DB trigger)

Chạy thêm migration: `supabase/migrations/003_study_review_rpc.sql`

## Notifications (Email / Discord)

Angular **chỉ quản lý preferences** tại `/settings/notifications`. Reminders được gửi **server-side** qua Supabase Edge Function — không gửi từ browser.

### Migration

Chạy `supabase/migrations/005_notification_system.sql` sau các migration trước.

| Bảng | Mô tả |
|------|-------|
| `notification_settings` | Channel: `EMAIL` \| `DISCORD` \| `BOTH` \| `NONE` |
| `notification_logs` | Dedup `(review_id, channel, notification_date)` |

### Edge Function deploy

```bash
supabase secrets set CRON_SECRET=your-random-secret
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set EMAIL_FROM="Reminders <onboarding@resend.dev>"
supabase functions deploy send-daily-reminders
```

Trong Supabase Dashboard → Edge Functions → **Schedules**:

- Cron: `0 * * * *` (hourly)
- Header: `Authorization: Bearer <CRON_SECRET>`

Function flow mỗi lần chạy:

1. Lấy users có channel ≠ `NONE`
2. Kiểm tra giờ local (timezone user) khớp `email_reminder_time`
3. Tìm reviews `PENDING` due **today** (local date)
4. Gửi Email (Resend) / Discord (user webhook)
5. Ghi `notification_logs` — không gửi trùng cùng review/channel/ngày

**Secrets không bao giờ đưa vào Angular** — chỉ `anon` key ở frontend.

## Cấu trúc thư mục

```
src/app/
  core/          enums, models, services, guards
  features/
    auth/        login, register
    calendar/    study-calendar (FullCalendar)
    admin/       dashboard, user-calendar
  shared/        app-shell, styles
supabase/
  migrations/    SQL schema + RLS
```
