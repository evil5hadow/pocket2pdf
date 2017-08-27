// Microsoft Windows 10 only - Read a list of URLs from a Pocket (nee Read-It-Later) export file
// Using puppeteer, try to get the URL and store it as <sanitized title>.{.raw.pdf,.txt.,.html}
// TODO: Integrate with the Pocket API to pull the URLs
// TODO: Allow setting limits on download, time ranges, and sorting order
// TODO: Integrate with Google Drive to upload the generated PDFs

// Output will be in ./output

const version = '20170826';
const out_dir = 'output';

const path = require('path');
const fs = require('fs');

// For Windows only, choose the location of the globally-installed modules
const username = process.env['USERPROFILE'].split(path.sep)[2];
const windows_install_path = "C:/Users/" + username + "/AppData/Roaming/npm/node_modules/";
const sanitize = require(windows_install_path + "sanitize-filename");
// For link parsing from an HTML file
const cheerio = require(windows_install_path + "cheerio");
const puppeteer = require(windows_install_path + "puppeteer");
const async = require(windows_install_path + "async");
const reader = require(windows_install_path + 'node-readability');
const pdf = require(windows_install_path + 'html-pdf');
const sprintf = require(windows_install_path + 'sprintf-js').sprintf;


if (!fs.existsSync(out_dir)) {
	fs.mkdirSync(out_dir);
}

function get_date(epoch) {
	// Get the year, month, and day.  
	var newDate = new Date(epoch);
	var dateString = '';
	dateString += sprintf('%04d', newDate.getFullYear());
	dateString += sprintf('%02d', newDate.getMonth() + 1);
	dateString += sprintf('%02d', newDate.getDate());
	return dateString;
};

// Check if a URL exists
var http = require('http'),
	url = require('url');

function does_url_exist(Url, callback) {
	var options = {
		method: 'HEAD',
		host: url.parse(Url).host,
		port: 80,
		path: url.parse(Url).pathname
	};
	var req = http.request(options, function (r) {
		callback(r.statusCode == 200);
	});
	req.end();
}


// Process the supplied URL and dump out files asynchronously
async function process_url(url, date, whenDone) {

	const browser = await puppeteer.launch();
	const page = await browser.newPage();

	try {
		await page.goto(url, {
			waitUntil: 'networkidle'
		});
		var title = await page.title();
		var sanitized_title = get_date(date) + ' - ' + sanitize(title);

		// If the URL was already captured, skip it
		if (fs.existsSync(out_dir + '/' + sanitized_title + '.html')) {
			console.log('Saved ' + num_processed_links++ + '/' + num_total_links + ' (' + num_error_links + ' failed) (SKIP):', sanitized_title);
			browser.close();
			whenDone(); // You MUST call this to signal to async that your operation is done
			return;
		} else {

			// Store the raw PDF of the page
			await page.pdf({
				path: out_dir + '/' + sanitized_title + '.raw.pdf',
				format: 'Letter',
				displayHeaderFooter: true,
				margin: {
					top: '1in',
					right: '1in',
					bottom: '1in',
					left: '1in'
				}
			});

			// Store the plain text content
			fs.writeFile(out_dir + '/' + sanitized_title + '.txt', await page.plainText(), function () {});

			// Store the cleaned up webpage
			reader(url, function (err, article, meta) {
				// Reject empty cleaned up articles
				if (article == undefined) {
					return;
				}
				if (article.content.length > 0) {
					// Store the article content as HTML
					fs.writeFile(out_dir + '/' + sanitized_title + '.html', article.content, function () {});

					// Skip PDF generation from HTML for now - broken on Windows
					if (false) {
						// Main Article 
						// console.log('Cleaned up article length:', article.content.length);
						pdf.create(article.content, {
							format: 'Letter'
						}).toFile(out_dir + '/' + sanitized_title + '.pdf', function (err, res) {
							if (err) {
								console.log('Error writing PDF:', out_dir + '/' + sanitized_title + '.pdf : ', err)
							};
							// Close article to clean up jsdom and prevent leaks
							console.log('Done writing PDF:', out_dir + '/' + sanitized_title + '.pdf');
							article.close();
						});
					}
				} else {
					console.log('ERROR: Invalid length for cleaned up article:', article.content.length);
					// Close article to clean up jsdom and prevent leaks 
					article.close();
				}
			});

			// Create a touchfile with the epoch date to allow faster skips in future runs
			fs.writeFile(out_dir + '/' + date + '.done', '', function () {});

			console.log('Saved ' + num_processed_links++ + '/' + num_total_links + ' (' + num_error_links + ' failed) :', sanitized_title);
			browser.close();
			whenDone(); // You MUST call this to signal to async that your operation is done

		}
	} catch (err) {
		console.log('Failed to retrieve URL:', url);
		num_error_links++;
		whenDone();
	};
};

// Use Cheerio to read in 
const incoming_url_file = 'ril_export.html';
var urls = [];
$ = cheerio.load(fs.readFileSync(incoming_url_file));
links = $('a'); //jquery get all hyperlinks
$(links).each(function (i, link) {
	var date = $(link).attr('time_added') * 1000; // Javascript requires millisecond precision
	var url_actual = $(link).attr('href');
	// If this epoch time (a proxy for the URL) was already captured, skip it
	if (!fs.existsSync(out_dir + '/' + date + '.done')) {
		urls.push({
			date_added: date,
			url: url_actual
		});
	} else {
		console.log('Skipping adding already-captured URL:', url_actual);
	}
});

var num_total_links = urls.length;
var num_processed_links = 0;
var num_error_links = 0;

console.log('Starting to process ' + num_total_links + ' URLs');

async.eachLimit(urls, 3, function (url_tuple, whenDone) {
	var url = url_tuple['url'];
	var date = url_tuple['date_added'];
	// Convert https to http
	// url = url.replace('https:', 'http:');
	does_url_exist(url, function () {
		process_url(url, date, whenDone); // Pass in the function to signal the async operation is done
	});
});