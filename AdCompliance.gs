const SPREADSHEET_ID = "1tb6x3JV_wC95jxstpYQ1hW7xKNVhN4TSLc6Zsui5ysU";
const TEMP = 0;
const GPT_MODEL = "gpt-4o";
const POLICY_FILE_PATH = "https://docs.google.com/spreadsheets/d/163ytY_todByb7luppgCsxY003ZBdeYtpHGO9fecqGf0/edit?gid=253256244#gid=253256244";
const POLICY_WORKSHEET_NAME = "Rules";
const CONTENT_CACHE_SHEET_NAME = "ContentCache";
const ENDPOINT = "/content";
const CM_EMAIL = "kleb.dale@terrific.co.il";


function main() {
 
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
  sheet.getRange(1, 1, 1, 7).setValues([['Ad ID', 'Type', 'Campaign Name', 'Ad Group Name', 'Content', 'isRestricted','Violations']]);
  
  // Load or create the content cache
  var contentCache = loadContentCache();
  
  // Iterate through the Ads
  const iterator = AdsApp.ads()
                  .withCondition("Type = RESPONSIVE_SEARCH_AD")
                  .withCondition("campaign.status = ENABLED")
                  .withCondition("ad_group_ad.status = ENABLED")
                  .withLimit(5)
                  .get();
  
  var row = 2;
  
  while (iterator.hasNext()) {
    let ad = iterator.next();
    let resAd = ad.asType().responsiveSearchAd();
    
    let adID = resAd.getId();
    let campaignName = resAd.getCampaign().getName();
    let adGroupName = resAd.getAdGroup().getName();
    
    let headlines = resAd.getHeadlines();
    let descriptions = resAd.getDescriptions();
    
    //For Headlines
    headlines.forEach((headline) => {
      processContent(sheet, contentCache, row, adID, campaignName, adGroupName, 'Headline', headline.text);
      row++;
      Utilities.sleep(300); //To Avoid API Error 429: Request per minute quota
    });
    

    //For Descriptions
    descriptions.forEach((description) => {
      processContent(sheet, contentCache, row, adID, campaignName, adGroupName, 'Description', description.text);
      row++;
      Utilities.sleep(300); //To Avoid API Error 429: Request per minute quota
    });
    Utilities.sleep(5000); //To Avoid API Error 429: Request per minute quota
  }
  
  saveContentCache(contentCache);
  sheet.autoResizeColumns(1, 7);
  
  // Notify campaign manager if a restricted ad copy is found
  notifyManager(sheet);
}


function callSwaggerApiFunction(endpoint, content, policyFilePath, policyWorksheetName) {
  var apiUrl = "https://ai-backend-service-content-app-dot-autoutm.ey.r.appspot.com" + endpoint;
  
  var options = {
    'method': 'POST',
    'contentType': 'application/json',
    'payload': JSON.stringify({
      "content": content,
      "policyFilePath": policyFilePath,
      "policyWorksheetName": policyWorksheetName,
      "modelConfig": {
        "temperature": TEMP,
        "model": GPT_MODEL
      }
    })
  };

  try {
    var response = UrlFetchApp.fetch(apiUrl, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();

    if (responseCode === 200) {
      var jsonResponse = JSON.parse(responseBody);
      return jsonResponse;
    } else {
      Logger.log('Error: ' + responseCode + ' ' + responseBody);
    }
  } catch (e) {
    Logger.log('Error: ' + e.toString());
  }
}

function loadContentCache() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  var cacheSheet = spreadsheet.getSheetByName(CONTENT_CACHE_SHEET_NAME);
  
  if (!cacheSheet) {
    // If the cache sheet doesn't exist, create it and return an empty cache
    cacheSheet = spreadsheet.insertSheet(CONTENT_CACHE_SHEET_NAME);
    cacheSheet.appendRow(['Hash ID', 'Ad ID', 'Type', 'Campaign Name', 'Ad Group Name', 'Content', 'isRestricted', 'Violations']);
    return {};
  }
  
  var data = cacheSheet.getDataRange().getValues();
  var cache = {};
  
  // Start from 1 to skip the header row
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var hashID = row[0];
    var adId = row[1];
    var type = row[2];
    var campaignName = row[3];
    var adGroupName = row[4];
    var content = row[5];
    var isRestricted = row[6];
    var violations = row[7];
    
    if (!cache.hasOwnProperty(hashID)){
      cache[hashID] = {};
    }
    
    cache[hashID] = {
        hashID: hashID,
        adID: adId,
        type: type,
        campaignName: campaignName,
        adGroupName: adGroupName,
        content: content,
        isRestricted: isRestricted,
        violations: violations
      };
  }
  return cache;
}

function processContent(sheet, contentCache, row, adID, campaignName, adGroupName, type, content) {
  
  // Check if the content already exists in the cache
  var hashID = generateSHA256Hash(content.toLowerCase());
  if (contentCache.hasOwnProperty(hashID)) {
    // Use cached result
    Logger.log("Cache Hit for content: " + content);
    var cachedResult = contentCache[hashID];
    sheet.getRange(row, 1, 1, 7).setValues([
      [adID, campaignName, adGroupName, type, content, cachedResult.isRestricted, cachedResult.violations]
    ]);
  } else {
    // Call API and store result
    var apiResult = callSwaggerApiFunction(ENDPOINT, content, POLICY_FILE_PATH, POLICY_WORKSHEET_NAME);
    
    if (apiResult) {
      var judgment = apiResult.content.isRestricted ? "Restricted" : "Okay";
      sheet.getRange(row, 1, 1, 7).setValues([
        [adID, campaignName, adGroupName, type, content, judgment, JSON.stringify(apiResult.content.violations)]
      ]);
      // Cache the result
      contentCache[hashID] = {
        hashID: hashID,
        adID: adID,
        campaignName: campaignName,
        adGroupName: adGroupName,
        type: type,
        content: content,
        isRestricted: judgment,
        violations: JSON.stringify(apiResult.content.violations)
      };
    }
  }
}

function saveContentCache(contentCache) {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = spreadsheet.getSheetByName(CONTENT_CACHE_SHEET_NAME);
  
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONTENT_CACHE_SHEET_NAME);
  } else {
    sheet.clear();
  }
  
  sheet.appendRow(['Hash ID', 'Ad ID', 'Type', 'Campaign Name', 'Ad Group Name', 'Content', 'isRestricted', 'Violations']);
  
  // Convert the contentCache object to rows
  var rows = [];
  for (var hashID in contentCache){
    var item = contentCache[hashID]
    rows.push([
      item.hashID,
      item.adID,
      item.type,
      item.campaignName,
      item.adGroupName,
      item.content,
      item.isRestricted,
      item.violations
      ])
    }

  // Write all rows at once for better performance
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 8).setValues(rows);
  }
  sheet.autoResizeColumns(1, 8);
}

function generateSHA256Hash(content) {
  // Compute SHA-256 hash for the given content
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, content);

  // Convert the raw hash bytes to a hexadecimal string
  var hashString = rawHash.map(function(byte) {
    var hex = (byte & 0xFF).toString(16); // Convert byte to hex
    return (hex.length === 1 ? '0' + hex : hex); // Ensure 2-digit format
  }).join('');
  
  return hashString; // Return the final SHA-256 hash string
}

function notifyManager(sheet){
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var restrictedAds = [];

  var isRestrictedIndex = headers.indexOf("isRestricted");
  for (var i = 1; i < data.length; i++) {
    if (data[i][isRestrictedIndex] === "Restricted") {
      restrictedAds.push(data[i]);
    }
  }

  if (restrictedAds.length > 0) {
    var emailBody = createEmailBody(headers, restrictedAds);
    sendEmail(emailBody, CM_EMAIL);
  }
}

function createEmailBody(headers, restrictedAds) {
  var htmlBody = "<h2>The following ads have been flagged as Restricted:</h2>";
  
  htmlBody += "<table border='1' style='border-collapse: collapse; width: 100%;'>";
  
  // Create table header
  htmlBody += "<tr style='background-color: #f2f2f2;'>";
  headers.forEach(function(header) {
    htmlBody += "<th style='padding: 8px; text-align: left;'>" + header + "</th>";
  });
  htmlBody += "</tr>";
  
  // Add each restricted ad to the table
  restrictedAds.forEach(function(ad, index) {
    htmlBody += "<tr" + (index % 2 === 0 ? " style='background-color: #f9f9f9;'" : "") + ">";
    ad.forEach(function(cell) {
      htmlBody += "<td style='padding: 8px;'>" + cell + "</td>";
    });
    htmlBody += "</tr>";
  });
  
  htmlBody += "</table>";
  
  return htmlBody;
}

function sendEmail(body) {
  var subject = "Ad Compliance Tool Alert: Restricted Ads Detected";
  
  MailApp.sendEmail({
    to: CM_EMAIL,
    subject: subject,
    htmlBody: body
  });
  Logger.log("Alert Email sent to " + CM_EMAIL);
}
