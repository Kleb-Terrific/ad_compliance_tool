const SPREADSHEET_ID = "1tb6x3JV_wC95jxstpYQ1hW7xKNVhN4TSLc6Zsui5ysU";
const TEMP = 0;
const GPT_MODEL = "gpt-4o";
const POLICY_FILE_PATH = "https://docs.google.com/spreadsheets/d/163ytY_todByb7luppgCsxY003ZBdeYtpHGO9fecqGf0/edit?gid=253256244#gid=253256244";
const POLICY_WORKSHEET_NAME = "Rules"
const CONTENT_CACHE_SHEET_NAME = "ContentCache"
const ENDPOINT = "/content"


function main() {
 
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
  sheet.getRange(1, 1, 1, 7).setValues([['Ad ID', 'Type', 'Campaign Name', 'Ad Group Name', 'Content', 'isRestricted','Violations']]);
  
  // Load or create the content cache
  var contentCache = loadContentCache();
  
  const iterator = AdsApp.ads()
                  .withCondition("Type = RESPONSIVE_SEARCH_AD")
                  .withCondition("campaign.status = ENABLED")
                  .withCondition("ad_group_ad.status = ENABLED")
                  .withLimit(11)
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
    cacheSheet.appendRow(['Ad ID', 'Type', 'Campaign Name', 'Ad Group Name', 'Content', 'isRestricted', 'Violations']);
    return {};
  }
  
  var data = cacheSheet.getDataRange().getValues();
  var cache = {};
  
  // Start from 1 to skip the header row
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var adId = row[0];
    var type = row[1];
    var campaignName = row[2];
    var adGroupName = row[3];
    var content = row[4];
    var isRestricted = row[5];
    var violations = row[6];
    
    if (!cache[adId]) {
      cache[adId] = {};
    }
    if (!cache[adId][type]) {
      cache[adId][type] = [];
    }
    
    cache[adId][type].push({
      campaignName: campaignName,
      adGroupName: adGroupName,
      content: content,
      isRestricted: isRestricted,
      violations: violations
    });
  }
  
  Logger.log(cache);
  return cache;
}

function processContent(sheet, contentCache, row, adID, campaignName, adGroupName, type, content) {
  // Check if the content already exists in the cache
  if (!contentCache[adID]) {
    contentCache[adID] = {};
  }
  if (!contentCache[adID][type]) {
    contentCache[adID][type] = [];
  }

  var cachedResult = contentCache[adID][type].find(item => item.content === content);
  
  if (cachedResult) {
    // Use cached result
    sheet.getRange(row, 1, 1, 7).setValues([
      [adID, type, cachedResult.campaignName, cachedResult.adGroupName, content, cachedResult.isRestricted, cachedResult.violations]
    ]);
  } else {
    // Call API and store result
    var apiResult = callSwaggerApiFunction(ENDPOINT, content, POLICY_FILE_PATH, POLICY_WORKSHEET_NAME);
    if (apiResult) {
      Logger.log(apiResult);
      var judgment = apiResult.content.isRestricted ? "Restricted" : "Okay";
      sheet.getRange(row, 1, 1, 7).setValues([
        [adID, type, campaignName, adGroupName, content, judgment, JSON.stringify(apiResult.content.violations)]
      ]);
      
      // Cache the result
      contentCache[adID][type].push({
        content: content,
        campaignName: campaignName,
        adGroupName: adGroupName,
        isRestricted: judgment,
        violations: JSON.stringify(apiResult.content.violations)
      });
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
  
  // Add headers
  sheet.appendRow(['Ad ID', 'Type', 'Campaign Name', 'Ad Group Name', 'Content', 'isRestricted', 'Violations']);
  
  // Convert the contentCache object to rows
  var rows = [];
  for (var adID in contentCache) {
    for (var type in contentCache[adID]) {
      contentCache[adID][type].forEach(function(item) {
        rows.push([
          adID,
          type,
          item.campaignName,
          item.adGroupName,
          item.content,
          item.isRestricted,
          item.violations
        ]);
      });
    }
  }
  
  // Write all rows at once for better performance
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
  
  // Optimize the sheet
  sheet.autoResizeColumns(1, 7);
}