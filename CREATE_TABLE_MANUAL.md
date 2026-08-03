# ⚡ CREATE RAZORPAY TABLE - 60 Second Guide

## 🚀 DO THIS NOW:

### Step 1: Copy This SQL
```sql
CREATE TABLE IF NOT EXISTS razorpay_settings (id INT PRIMARY KEY DEFAULT 1, enabled BOOLEAN DEFAULT false, razorpay_key_id TEXT, razorpay_key_secret TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT razorpay_settings_singleton CHECK (id = 1)); ALTER TABLE razorpay_settings ENABLE ROW LEVEL SECURITY; INSERT INTO razorpay_settings (id, enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING;
```

### Step 2: Open Supabase
```
https://app.supabase.com
```

### Step 3: Click SQL Editor
In left sidebar → SQL Editor → New Query

### Step 4: Paste & Run
Paste the SQL above → Click RUN button

### Step 5: Verify
```sql
SELECT * FROM razorpay_settings;
```

Should return 1 row with id=1

---

## ✅ Done! Now test:

```
http://localhost:3000/#card-tool
Phone: 9223548779
OTP: 1234
Click "Razorpay" tab → Should work!
```

---

## If You Need Help:
Run this to verify:
```bash
node create-table-direct.js
```

It will confirm the table exists once you create it manually.
