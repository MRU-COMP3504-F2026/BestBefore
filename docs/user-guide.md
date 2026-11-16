# BestBefore User Guide

## **A high-level description**

BestBefore is a food expiry tracker that runs in your web browser, or as a progressive web app (PWA) on your mobile device that allows you to manage groceries, monitor expiration dates, and reduce food waste. Users can add groceries by scanning product barcodes using their phone's camera or by using AI-powered image recognition to identify food items. Once identified, users can record purchase and expiration dates to keep track of their groceries and know when items should be used before they expire.

**Why use BestBefore?**

* **Waste less food:** Items about to expire are flagged so you use them before they go bad.  
* **Save money:**  Reduce the amount of food thrown away by keeping track of what you already have and avoiding unnecessary grocery purchases.  
* **Support grocery shopping:** Keep track of what you have and what you need to buy, helping you avoid unnecessary purchases and remember items to restock.  
* **Add groceries quickly:** Use barcode scanning or AI-powered image recognition to identify food items and add them to your inventory.  
* **Make smarter shopping decisions:**  Check your existing inventory before shopping to avoid buying items you already have.

## **How to install the software**

BestBefore is a Progressive Web App (PWA), so no traditional installation or additional software is required, so no download, and no setup. Users can access the application directly through a web browser using the provided URL. Mobile users also have the option to add BestBefore to their device's home screen for convenient access, allowing it to function like a regular mobile application.

**Application URL: [https\://best-before-ten.vercel.app/](https://best-before-ten.vercel.app/)**

**Add BestBefore to your home screen**

**Android (Chrome):**

1. Tap the ⋮ menu in the top-right corner.  
2. Tap Install app (or Add to Home screen).  
3. Tap Install. A BestBefore icon appears on your home screen.

   **iPhone / iPad (Safari):**

1. Tap the Share button (the square with an arrow).  
2. Scroll down and tap Add to Home Screen.  
3. Tap Add. A BestBefore icon appears on your home screen.

## **How to run the software**

**Prerequisites and Device Requirements**

| What you need | Version | Why it's needed |
| ----- | ----- | ----- |
|  **Phone or tablet *(recommended)*** | **Android:** Android 10 or newer, using Chrome  **iPhone / iPad:** iOS / iPadOS 16.4 or newer, using Safari | A computer supports all BestBefore features, including barcode scanning. However, a mobile device is recommended for easier camera access, more convenient scanning, and the option to add the app to your home screen. |
| **Web browser** | Google Chrome or Safari (one of the two most recent versions). | BestBefore runs in your browser. You need to open it in a browser on your device before you can use it or add it to your home screen. |
| **Camera** | Any built-in camera  | Barcode scanning and image recognition (Camera permissions must be enabled when prompted) |
| **Internet Connection** | Stable connection  | Logging in, looking up barcodes, AI features, and saving your items |

**Getting started**

1. Go to the BestBefore URL. Open the URL (https\://best-before-ten.vercel.app/) in your browser.  
2. Add BestBefore to your home screen. Then open BestBefore from the new icon. From now on, just tap the icon to open it.  
3. Create an account. First login, tap Sign Up, enter your email address and a password, then tap Create Account.  
4. Log in. enter your email and password and tap Log In.  
5. Start adding food. After you log in, your inventory dashboard opens. It's empty at first. 

## **How to use the software**

**The main screen (inventory dashboard)**

After logging in, you will be directed to the Home Page, which provides an overview of your grocery inventory and quick access to the main features.

The dashboard includes:

* **My Items:** Displays your grocery items, including their names, best-before dates, and colour-coded expiration statuses.  
* **Scan Barcode:** Quickly access the scanning feature to add groceries.  
* **Bottom Navigation:** Switch between Home, Scan, and My Items to navigate the application.  
* **Profile:** Access your profile options, including logging out.  
* **Expiration Status:** View colour-coded indicators to identify items that are active, expiring soon, or expired.

**Expiration Status Colour Coding:** 

- 🟢 Active: The item's best-before date is more than 3 days away.  
- 🟡 Expiring Soon: The item's best-before date is within the next 3 days.  
- 🔴 Expired: The item's best-before date has already passed.

**Add an item by scanning its barcode**

1. From the inventory, tap Add Item, then Scan Barcode.  
2. Allow camera access if prompted.  
3. Point the camera at the barcode and hold steady. Use the on-screen frame as a guide.  
4. When the barcode is read, BestBefore looks up the product and shows its name, brand, suggested category and photo (if available).  
5. Enter the best-before date with the date picker and make an edit you would like..  
6. Tap Save. The item now appears in your inventory.

If something goes wrong, add items manually.

**Add an item manually**

1. In the inventory, tap Add Item, then Add Item Manually.  
2. Fill in the product information and the best-before date.  
3. Tap submit. Missing or invalid fields are highlighted, and the item is not saved until they are fixed.  
4. Tap Back to Inventory to see the updated list. You can cancel at any time before submitting.

**Edit an item**

Open an item and update its details, or remove it.

### **Delete expired items**

There are two ways to delete items: remove a single expired item straight from the inventory list, or use the Remove Items screen to remove several at once.

#### **Remove one expired item**

Expired items are marked in red on the inventory list, with a label such as "Expired on Nov 14, 2026".

1. On the inventory page, find the expired item (red stripe and red date label).  
2. A red Remove button appears beside the item. \[confirm: shown automatically for expired items, or revealed by a swipe/tap\]  
3. Tap Remove. The item is deleted and disappears from the list.

#### **Remove several items at once**

1. On the inventory page, tap Remove Items, next to Add Item. This opens the Remove Items screen, which lists every item in your inventory with a checkbox on the right of each one. Use the back arrow at the top left to return to the inventory without removing anything.  
2. Choose the items to remove in one of three ways:  
   * Select all ticks for every item in the list.  
   * Select expired ticks only the items that are past their best-before date (the red ones), which is the quickest way to clear out expired food.  
   * Tap a checkbox to tick or untick an individual item. You can also use Select all or Select expired first and then untick any item you want to keep.  
3. Check the button at the bottom of the list. It shows how many items are ticked, for example Remove selected (3). While nothing is ticked it reads Remove selected (0) and is greyed out, so you cannot remove anything by accident.  
4. Tap Remove selected to delete the ticked items. The items disappear from your inventory. Removal is permanent. 

**AI Assistant**

AI Vision allows users to identify grocery items by taking a picture using their device's camera. It analyzes the image and provides its best estimate of the food item's name and relevant product information.

1. Select Scan from the dashboard.  
2. At the top of the scanning screen, select AI Vision instead of Barcode.  
3. Point your camera at the food item and capture an image.  
4. Wait for the AI to analyze the image and identify the item.  
5. Review the suggested product name and information.  
6. Confirm or correct the details before adding the item to your grocery inventory.

**Features in progress**

The following features are planned for future development but are not yet available in the current version of BestBefore.

|  Feature |  Description |
| ----- | ----- |
|  **Recurring Shopping List** | Keep track of frequently purchased items and make restocking easier. |
| **Profile Management** | Allow users to edit their account information and reset their passwords through the Profile page. |
| **Keep Expired Item and Set a Later Reminder** | Allows users to keep items that might still be usable or need a second look. Prevents accidental deletion.   |
| **Remove Inventory by Category** | Remove entire groups of items based on their category.  |
| **Look up Manually Typed Barcode** | Accept barcode when typed in, send it through the same product lookup path. |
| **AI Inventory Summarizer**  | Allows users to summarize what they have in their inventory using AI.  |

## **How to Report a Bug** 

If something in BestBefore stops working, or behaves in a way you did not expect, you can let our team know right from the app. You do not need a technical background to send a report. 

**Step 01: Open the Bug Report Form** 

1. Open BestBefore and go to your Profile page (tap the Profile icon in the menu).  
2. Tap the Report a Bug button.  
   ![][image1]  
3. A new browser tab will open to our Bug Report form on GitHub. 

\*(Note: You will need to sign in to a free GitHub account to submit the form.)\* 

**Step 02: Fill Out What Happened**

Before starting a new report, glance at the **Known Bugs & Limitations** list below to make sure it is not an issue we are already working on. Otherwise, fill in the boxes on the form using everyday language:

* **Title:**Write a short summary of the problem at the top (for example:   
  "\[Bug\]: Barcode scanner will not open on my iPhone").

 

* **Severity Level:** Pick how much the problem gets in your way:  
  * **Low:** A minor visual issue, like a spelling mistake or misaligned text.  
  * **Medium:** Something is not working quite right, but you can still use the app another way.  
  * **High:** A main feature—like scanning barcodes or saving groceries—is broken.  
  * **Critical:** The app crashes, freezes completely, or will not let you log in.

* How Often It Happens: Let us know if it happens every single time you try, only occasionally, or just once.

 

* **Bug Description:** Explain in your own words what went wrong.

* **Steps to Reproduce:** List the exact buttons you tapped leading up to the problem so we can follow your footsteps and see it for ourselves. For example:  
  * Open the Scan tab.  
  * Point the camera at a cereal box barcode.  
  * Tap Save, and an error message appears.  
* **Expected vs. Actual Behavior:** Tell us what you thought would happen versus what actually happened on your screen.

* **Device & Browser Details:** Tell us what kind of phone, tablet, or computer you are using and which web browser you opened (for example: "iPhone 15 using Safari" or "Windows laptop using Google Chrome").

* **Screenshots or Screen Recording (Recommended):** If you can take a screenshot or short screen recording of the problem, drag and drop or paste it into the form. Seeing what is on your screen helps us fix the issue much faster.

**Step 3: Submit Your Report**

Once you have filled in the details, scroll to the bottom and click **Submit** new issue.   
Your report goes straight to our team's task board so we can investigate and fix it.

## 

## **Known Bugs & Limitations**

To keep testers fully informed during the beta release, current limitations, planned features, and active bugs undergoing verification on our GitHub project board are documented below. If you encounter an issue that is not listed here, please report it using **Profile → Report a Bug** inside the application.

**Active Bugs in Testing Phase**

| Issue | What You Might Notice | Workaround / Status |
| :---- | :---- | :---- |
| \[BUG\]: Investigate edge cases for barcode name/cat best before matching, normalization malformed responses, a best before date no update issues[\#186](https://github.com/MRU-COMP3504-F2026/BestBefore/issues/186)  | Scanning certain product barcodes may return an incomplete product name, an unexpected food category, or a missing suggested expiry window. | **Workaround:** Review the auto-filled fields after scanning and edit the name, category, or best-before date manually  before tapping Save.  **Status:** In Testing |
| \[BUG\]: Investigate and handle non-English normalized responses during product lookup stage of barcode-inventory pipeline[\#183](https://github.com/MRU-COMP3504-F2026/BestBefore/issues/183)  | Scanning imported or international groceries may pull product titles and descriptions in a language other than English from external barcode databases.  | **Workaround:** Edit the product name in English before saving, or use Add Item Manually if the lookup result is difficult to read.  **Status:** In Testing |
| \[BUG\]: JWT Mismatch Prevents Authed User Item Add[\#187](https://github.com/MRU-COMP3504-F2026/BestBefore/issues/187) | Logged-in users may occasionally encounter an authentication error that prevents a newly scanned or entered item from saving to their inventory. | **Workaround:**  Go to Profile **→** Log out, sign back in to refresh your active session, and try adding the item again.  **Status:** In Testing |

**Limitations** 

| Limitation | Description & Impact | Workaround / Status |
| :---- | :---- | :---- |
| **Camera Permissions on Older Browsers**  | On certain mobile browsers older than iOS 16.4 or Android 10, the barcode scanner camera stream may occasionally fail to initialize on the first try. | **Workaround:** Ensure camera permissions are explicitly allowed in your browser setting, or use the Add Item Manually fallback feature.  |
| **AI Vision Processing Time** | Using AI Vision via camera upload can take 3-5 seconds depending on the connection speed.  | **Status:** Expected behavior during peak network usage; a loading indicator is displayed while processing.  |

[image1]: <data:image/png;base64,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>