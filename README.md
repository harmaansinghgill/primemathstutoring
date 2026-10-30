# Prime Maths Tutoring website

A website for Prime Maths Tutoring: a home page, plus a booking page and a contact page that aren't in the tabs. Buttons and links lead to them. It's plain HTML and CSS with no build step, so it can be hosted for free on GitHub Pages.

## What's in here

| File | What it is |
| --- | --- |
| `index.html` | The home page: almost all the text lives here |
| `book.html` | The booking page. It isn't in the tabs; the "Book a free intro" buttons lead to it |
| `contact.html` | The contact page, with a "What's it about?" picker. Links like `contact.html#prices` open it with that topic already picked |
| `site.js` | The moving parts: the feedback carousel, the tabs and sending the forms |
| `styles.css` | Colours, fonts and layout |
| `favicon.svg` | The little icon in the browser tab |
| `fonts/` | The typeface (Outfit), hosted with the site |
| `images/logo.svg`, `images/logo.png` | The logo for white backgrounds (printouts, documents) |
| `images/logo-on-dark.svg`, `images/logo-on-dark.png` | The main logo, on black. Use it for profile pictures on Instagram, TikTok and similar |
| `images/og.png` | The preview image that shows when someone shares the link on WhatsApp, iMessage and so on |
| `images/apple-touch-icon.png` | The icon used if someone saves the site to their iPhone home screen |

## Colours

The colours are set once, at the top of `styles.css`, so switching scheme means changing those values. The current scheme is Black & Gold:

| Name | Hex | Used for |
| --- | --- | --- |
| Black | `#0A0A0B` | Page background |
| Gold | `#E8AE4A` | Buttons, links, the logo shapes, highlighted words |
| Prime blue | `#6E8BFF` | Prime dots in the logo |
| Off-white | `#F4F4F2` | Main text |
| Warm grey | `#A6A6A2` | Secondary text |

The logo is "see-through": none of the shapes is filled, so all 100 dots stay visible. `images/logo-on-dark.svg` is the main version; `images/logo.svg` is a version for white backgrounds, with darker gold so it stays readable.

## Feedback carousel

The "What families say" cards scroll on their own every 5 seconds and pause when someone hovers over or taps them. To add a card, search `index.html` for `Feedback carousel`, copy one of the `<li>` blocks below it and change the words. Only use feedback families have actually given, with their permission.

## Putting it live with GitHub Pages

1. Create a new **public** repository on GitHub called `primemathstutoring`.
2. Upload everything in this folder to it, or push it with git.
3. In the repository, go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute the site is live at `https://harmaansinghgill.github.io/primemathstutoring/`.

### Connecting your domain

1. In **Settings → Pages → Custom domain**, type your domain (for example `www.primemathstutoring.co.uk`) and save. GitHub adds a `CNAME` file to the repository for you.
2. Log in to wherever you bought the domain and add these DNS records:
   - Four **A** records for the bare domain (`@`) pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`.
   - One **CNAME** record for `www` pointing to `harmaansinghgill.github.io`.
   - Delete any old A or CNAME records left over from the previous website builder.
3. DNS changes can take from a few minutes to a day to come through. Once GitHub shows the domain as working, tick **Enforce HTTPS**.

If you own both the `.co.uk` and the `.com`, point the second one at the first using your registrar's "domain forwarding" setting.

## Common edits

**Prices** (currently £25 KS3 and GCSE, £30 A-level Maths, £35 A-level Further Maths) appear in four places in `index.html`: the "At a glance" box near the top, the price table, the "How much does it cost?" FAQ and the `priceRange` line near the top of the file. Search the file for `£` to find them all.

**Your photo:** the round picture in the About section shows the logo for now. To use a photo instead, save it as `images/harmaan.jpg` (square, at least 400 × 400 pixels), then in `index.html` find `<div class="avatar"` and replace everything inside it with `<img src="images/harmaan.jpg" alt="">`.

**The discount line:** search for `discount` in `index.html`. It appears in the prices section and in the FAQ.

## Getting form messages in your email

The booking form (`book.html`) and the question form (`contact.html`) are built into the site. Neither sends until every required box is filled in properly: on the booking form that's the student's name, email, phone, year group and subject. They send through **Web3Forms**, a free service (250 messages a month) that emails each submission to you. It's set up: the access key is in `site.js`. To send form emails somewhere else, get a new key for that address and replace it.

1. Go to https://web3forms.com, enter your **personal email** and click **Create Access Key**.
2. Check your inbox for the access key (a long code).
3. In `site.js`, search for `PASTE-YOUR-ACCESS-KEY-HERE` and replace it with your key, keeping the quote marks.
4. Submit a test booking on the live site and check it arrives. Look in spam the first time, and mark it "not spam".

Each email shows the subject "New booking: free intro session" or "New question from the website". Hitting **Reply** replies straight to the parent or student.

## Setting up hello@primemathstutoring.co.uk

The contact page shows `hello@primemathstutoring.co.uk`. To make that address forward to your personal email:

- **If your domain company offers email forwarding** (most do, including GoDaddy, Namecheap, 123 Reg and IONOS): find "Email forwarding" in your domain settings and forward `hello@` to your personal address.
- **If not**, use **Cloudflare Email Routing**, which is free: add your domain to Cloudflare, open **Email → Email Routing**, and create a rule sending `hello@` to your personal address. Cloudflare walks you through the DNS records it needs.

If your main domain turns out to be `.com`, change `primemathstutoring.co.uk` in `contact.html` (the email link) and in `site.js` (the `CONTACT_EMAIL` line).

## To-do list

- [ ] If lessons move from Zoom to Discord, change the four mentions of Zoom: `index.html` (the "At a glance" box, step 3 of How It Works, and the "Are lessons online?" FAQ) and `contact.html` (Quick answers). Search each file for `Zoom`.

- [ ] Connect www.primemathstutoring.co.uk (see "Connecting your domain")
- [x] Get a Web3Forms access key (done: it's in `site.js`)
- [ ] Set up email forwarding for `hello@primemathstutoring.co.uk` (see above)
- [ ] Add a photo of Harmaan
- [ ] Keep adding feedback to the carousel as it comes in (with permission)
- [ ] Add social media links to the footer, if you want them
- [ ] DBS checks for all tutors. Self-employed tutors apply for an Enhanced check through a DBS umbrella body: https://www.gov.uk/guidance/dbs-checks-for-self-employed-people-and-personal-employees
- [ ] Register the business
- [ ] Add a privacy policy page (the booking form collects children's details)
- [ ] Check whether you need to pay the ICO data protection fee once registered: https://ico.org.uk/for-organisations/data-protection-fee/
