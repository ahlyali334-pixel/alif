# بورتفوليو Ali Mohamed – فرونت + باك إند

باك إند Node.js مع قاعدة بيانات SQLite، **من غير أي مكتبات خارجية** (مفيش `npm install`).

## المميزات
- معرض مشاريع بيتحمّل من قاعدة البيانات، وفيه لايكات (لايك واحد لكل زائر)
- نموذج تواصل بيتخزن في قاعدة البيانات (فيه حماية من السبام)
- دفتر زوار عام
- عداد زيارات
- لوحة تحكم `/admin` بباسورد: قراءة وحذف الرسائل، إدارة دفتر الزوار، إضافة وتعديل وحذف المشاريع
- عربي / إنجليزي، وضع ليلي، وزر Save as PDF

## التشغيل على جهازك
1. ثبّت Node.js بإصدار **22.13 أو أحدث** (من nodejs.org)
2. انسخ `.env.example` باسم `.env` وعدّل `ADMIN_PASSWORD` و`SESSION_SECRET`
3. شغّل:
   ```
   node server.js
   ```
4. افتح http://localhost:3000 والإدارة على http://localhost:3000/admin

## النشر (Render كمثال)
1. ارفع المجلد على GitHub
2. على Render اعمل **Web Service** من الريبو، وخلّي Start Command: `node server.js`
3. في Environment أضف: `ADMIN_PASSWORD` و`SESSION_SECRET` و`DATA_DIR=/data` وكمان `NODE_VERSION=22`
4. أضف **Persistent Disk** واجعل Mount Path هو `/data`، ودي مهمة جداً، من غيرها قاعدة البيانات هتتمسح مع كل نشر
5. اربط دومين خاص لو عايز

(Railway وFly.io شغالين بنفس الفكرة: متغيرات البيئة + volume للبيانات.)

## ملاحظات
- النسخة الاحتياطية = ملف `portfolio.db` جوه `DATA_DIR`
- لتعديل المحتوى الثابت (الخبرة، المهارات، النصوص) عدّل `public/index.html`
- غيّر إيميلك أو رقم واتساب في `public/index.html` لو احتجت
