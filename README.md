# 🎓 Quest Student

Talabalar uchun savol kartalari. Ustoz Word fayldan savollarni yuklaydi, har bir savol uchun raqamli karta paydo bo'ladi, talabalar raqam tanlaydi va ustoz javobni baholaydi.

## Imkoniyatlar
- **Savollar** Word (`.docx`) yoki `.txt` fayldan yuklanadi, 200 tagacha savol uchun kartalar avtomatik kichrayadi
- **Talabalar ro'yxati** (ixtiyoriy): Excel (`.xlsx`, `.xls`, `.csv`) yoki Word fayldan
- **Start** bosilgandan keyin ekranda faqat kartalar qoladi; tanlangan karta qayta tanlanmaydi
- **Aralashtirish** savollarni kartalar bo'yicha qaytadan aralashtiradi va hamma kartani yana ochiq qiladi
- **Baholash**: A'lo / Qoniqarli / Yomon
- **🔊 Tinglash**: savolni ovoz chiqarib o'qiydi (ko'rishda muammosi bor talabalar uchun)
- **№ raqam** maydoni: talaba aytgan raqamli kartani tez ochish
- **Hisobot**: Excel faylga yuklab olinadi
- Til: **O'zbek / English**
- Fayllar faqat brauzerda qayta ishlanadi, hech qayerga yuborilmaydi

## Savollar fayli formati
Har bir savol raqam bilan boshlanadi (`1.`, `2)`, ...) yoki Word'ning avtomatik raqamlangan ro'yxatida bo'ladi. Raqam bo'lmasa, har bir paragraf alohida savol hisoblanadi. Namunalar: `samples/` papkasida.

## GitHub Pages'da ishga tushirish (bepul)
1. Repozitoriy **Settings → Pages** bo'limiga kiring
2. **Source**: `Deploy from a branch`, branch va `/ (root)` papkani tanlang, **Save** bosing
3. 1–2 daqiqadan so'ng sayt `https://<username>.github.io/quest_student/` manzilida ochiladi
