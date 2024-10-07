function main() {
 
  const sheet = initializeSpreadsheet();

  var row = 2;
  
  // Load or create the content cache
  var contentCache = loadContentCache();
  
  // Iterate through Google Ads
  const iterator = fetchGoogleAds();
  processGoogleAds(iterator, sheet, contentCache, row);
  
  // Iterate through Meta Ads (On-Hold)
  // Iterate through LinkedIn Ads (On-Hold)
  
  // Update Content Cache sheet
  saveContentCache(contentCache);
  
  // Notify campaign manager if a restricted ad copy is found
  notifyManager(sheet);
}


function initializeSpreadsheet(){
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
  sheet.clearContents();
  sheet.getRange(1, 1, 1, COLUMN_HEADERS.length).setValues([COLUMN_HEADERS]);
  return sheet;
}


function loadContentCache() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  var cacheSheet = spreadsheet.getSheetByName(CONTENT_CACHE_SHEET_NAME);
  
  if (!cacheSheet) {
    // If the cache sheet doesn't exist, create it and return an empty cache
    cacheSheet = spreadsheet.insertSheet(CONTENT_CACHE_SHEET_NAME);
    return {};
  }
  
  cacheSheet.getRange(1, 1, 1, CACHE_COLUMN_HEADERS.length).setValues([CACHE_COLUMN_HEADERS]);
  var data = cacheSheet.getDataRange().getValues();
  var cache = {};
  
  // Start from 1 to skip the header row
  for (var i = 1; i < data.length; i++) {
    const [hashID, adId, type, campaignName, adGroupName, content, isRestricted, violations, actionTaken] = data[i];
    
    if (!cache.hasOwnProperty(hashID)){
      cache[hashID] = {};
    }
    
    cache[hashID] = {
      hashID,
      adId,
      type,
      campaignName,
      adGroupName,
      content,
      isRestricted,
      violations,
      actionTaken
    };
  }
  return cache;
}


function fetchGoogleAds(){
  return AdsApp.ads()
    //.withCondition("Type = RESPONSIVE_SEARCH_AD")
    .withCondition("campaign.status = ENABLED")
    .withCondition("ad_group.status = ENABLED")
    .withCondition("ad_group_ad.status = ENABLED")
    //.withLimit(20)
    .get();
}


function processGoogleAds(iterator, sheet, contentCache, row){
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
        executeWithRetry(() => {
          processContent(sheet, contentCache, row, adID, campaignName, adGroupName, 'Headline', headline.text);
        });
        row++;
      });

      //For Descriptions
      descriptions.forEach((description) => {
        executeWithRetry(() => {
          processContent(sheet, contentCache, row, adID, campaignName, adGroupName, 'Description', description.text);
        });
        row++;
      });
  }
  
  return row;
}


function executeWithRetry(func, maxRetries = 5){
  for (let i = 0; i < maxRetries; i++) {
    try {
      return func();
    } catch (e) {
      if (e.message.includes('429') || e.message.includes('rate limit')) {
        if (i === maxRetries - 1) throw e;  // If this was the last attempt, rethrow the error
        const sleepTime = Math.pow(2, i) * 1000 + Math.round(Math.random() * 1000);
        Utilities.sleep(sleepTime);
      } else {
        throw e;  // Rethrow if other error
      }
    }
  }
}


function processContent(sheet, contentCache, row, adID, campaignName, adGroupName, type, content) {
  // Creating unique hash ID for each content
  var hashID = generateSHA256Hash(content.toLowerCase());
  
  // Check if the content already exists in the cache
  if (contentCache.hasOwnProperty(hashID)) {
    // Use cached result
    var cachedResult = contentCache[hashID];
    
    sheet.getRange(row, 1, 1, 7).setValues([
      [adID, campaignName, adGroupName, type, content, cachedResult.isRestricted, cachedResult.violations]
    ]);
    
    if (cachedResult.actionTaken === "False Positive"){
      cachedResult.isRestricted = "Marked False Positive Before";
    }
  } else { // Call API and store result
    var apiResult = checkContentRestrictions(content);
    
    if (apiResult) {
      var judgment = apiResult.content.isRestricted ? "Restricted" : "Okay";
      sheet.getRange(row, 1, 1, 7).setValues([
        [adID, campaignName, adGroupName, type, content, judgment, formatViolationContent(JSON.stringify(apiResult.content.violations))]
      ]);
      // Cache the result
      contentCache[hashID] = {
        hashID,
        adID,
        campaignName,
        adGroupName,
        type,
        content,
        isRestricted: judgment,
        violations: formatViolationContent(JSON.stringify(apiResult.content.violations)),
        actionTaken: ""
      };
    }
  }
}


function checkContentRestrictions(content) {
  var options = {
    'method': 'POST',
    'contentType': 'application/json',
    'payload': JSON.stringify({
      "content": content,
      "policyFilePath": POLICY_FILE_PATH,
      "policyWorksheetName": POLICY_WORKSHEET_NAME,
      "modelConfig": {
        "temperature": TEMP,
        "model": GPT_MODEL
      }
    })
  };

  try {
    var response = UrlFetchApp.fetch(API_ENDPOINT, options);
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


function saveContentCache(contentCache) {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = spreadsheet.getSheetByName(CONTENT_CACHE_SHEET_NAME);
  
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONTENT_CACHE_SHEET_NAME);
  }
  
  sheet.getRange(1, 1, 1, CACHE_COLUMN_HEADERS.length).setValues([CACHE_COLUMN_HEADERS]);
  
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
      item.violations,
      item.actionTaken
      ])
    }

  // Write all rows at once for better performance
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 9).setValues(rows);
  }
}

function formatViolationContent(violationJson){
  // Empty. For ad copies with no violation
  if (!violationJson || violationJson === '[]'){
    return '';
  }

  try { 
    var violation = JSON.parse(violationJson);
    violation = violation[0];
    
    // For ad copies with violation
    var formattedViolations = '';
    formattedViolations += '•Rule Name: ' + violation.ruleName + '\n';
    formattedViolations += '•Violated Part: ' + violation.violatedPart + '\n';
    formattedViolations += '•Reason: ' + violation.reason + '\n';
    formattedViolations += '•Suggestions:\n';
    
    violation.suggestions.forEach(function(suggestion) {
      formattedViolations += '  - ' + suggestion + '\n';
    });
    
    return formattedViolations.trim();
    
  } catch (e) {
    return 'Error parsing violations: ' + e.toString();
  }
}

function generateSHA256Hash(content) {
  // Compute SHA-256 hash for the given content
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, content);

  // Convert the raw hash bytes to a hexadecimal string
  var hashString = rawHash.map(function(byte) {
    var hex = (byte & 0xFF).toString(16); // Convert byte to hex
    return (hex.length === 1 ? '0' + hex : hex); // Ensure 2-digit format
  }).join('');
  
  return hashString; 
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
  }else{
    Logger.log("No Restricted Ads Found");
  }
}

function createEmailBody(headers, restrictedAds) {
  var htmlBody = "<h2>The following ads have been flagged as Restricted:</h2>";
  
  htmlBody += "<table border='1' style='border-collapse: collapse; width: 100%;'>";
  
  // Headers
  htmlBody += "<tr style='background-color: #f2f2f2;'>";
  headers.forEach(function(header) {
    htmlBody += "<th style='padding: 8px; text-align: left;'>" + header + "</th>";
  });
  htmlBody += "</tr>";
  
  // Adding the restricted ads into the email body
  restrictedAds.forEach(function(ad, index) {
    htmlBody += "<tr" + (index % 2 === 0 ? " style='background-color: #f9f9f9;'" : "") + ">";
    ad.forEach(function(cell) {
      htmlBody += "<td style='padding: 8px;'>" + cell + "</td>";
    });
    htmlBody += "</tr>";
  });
  
  htmlBody += "</table>";
  
  htmlBody += "<br>If you think that the ADS are falsely flagged as having RESTRICTED CONTENT. Please mark them as \"FALSE POSITIVE\" in the CONTENT CACHE sheet.";
  htmlBody += "Link to Google Sheet: https://docs.google.com/spreadsheets/d/1tb6x3JV_wC95jxstpYQ1hW7xKNVhN4TSLc6Zsui5ysU/edit?gid=1077009495#gid=1077009495";
  
  return htmlBody;
}

function sendEmail(body) {
  var subject = "[Terrific URGENT] Ad Compliance Tool Alert: Restricted Ads Detected";
  
  MailApp.sendEmail({
    to: CM_EMAIL,
    cc: CC_EMAILS,
    subject: subject,
    htmlBody: body
  });
  Logger.log("Alert Email sent to " + CM_EMAIL + "\nCCed: " + CC_EMAILS);
}
