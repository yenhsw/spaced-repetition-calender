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
2. Chạy các migration trong `supabase/migrations/` (theo thứ tự 001 → 005)
3. **Auth (bắt buộc cho đăng ký username + mật khẩu):**
   - Dashboard → **Authentication** → **Providers** → **Email**
   - Tắt **Confirm email** (app không dùng email thật để đăng nhập)
   - Nếu bật Confirm email, Supabase sẽ gửi mail tới `@spaced-rep.app` và dễ gặp lỗi `email rate limit exceeded` khi dev
4. (Tuỳ chọn) Tạo admin thủ công:

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

Chạy `005`, `007`, `008`, `009_review_reminder_schedules.sql` sau các migration trước.

| Bảng / cột | Mô tả |
|------------|-------|
| `notification_settings` | Channel: `EMAIL` \| `DISCORD` \| `BOTH` \| `NONE` + timezone |
| `study_topics.reminder_time` | Giờ nhắc ôn theo topic (mặc định **08:30**, đặt khi tạo topic) |
| `review_reminder_schedules` | `send_at` = ngày ôn + `reminder_time` (timezone user) |
| `notification_logs` | Dedup `(review_id, channel, notification_date)` |

### Edge Function deploy

```bash
supabase secrets set CRON_SECRET=your-random-secret
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set EMAIL_FROM="Reminders <onboarding@resend.dev>"
supabase functions deploy send-daily-reminders
supabase functions deploy send-test-email
supabase functions deploy trigger-my-reminders
supabase functions deploy sync-reminder-schedules
```

Trong app: `/settings/notifications` → **Gửi email thử** / **Chạy nhắc ngay**.

**Không poll mỗi phút.** Khi tạo/sửa topic hoặc lưu cài đặt thông báo, app gọi `sync-reminder-schedules`:

1. Tính `send_at` cho mỗi review pending = `review_date` + `study_topics.reminder_time` (theo timezone)
2. **Email (Resend):** lên lịch gửi đúng `send_at` (`scheduled_at`) trong vòng 30 ngày
3. **Discord / email quá hạn:** gửi ngay nếu `send_at` đã qua

Cron dự phòng (Supabase Dashboard → Edge Functions → **Schedules** trên `send-daily-reminders`):

- Cron: `0 0 * * *` (1 lần/ngày — gia hạn lịch 30 ngày + xử lý Discord / lỗi)
- Header: `Authorization: Bearer <CRON_SECRET>`

Không cần cron mỗi phút — email đúng giờ topic nhờ Resend schedule.

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
