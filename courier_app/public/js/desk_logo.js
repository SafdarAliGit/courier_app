frappe.ready(function () {
	var logo = frappe.boot && frappe.boot.company_logo;
	if (!logo) return;

	// Frappe v15 desk: the brand anchor sits in .navbar-header .navbar-home
	// It contains either an <img> or an <svg> for the app icon.
	var brand = document.querySelector('.navbar-header .navbar-home, .navbar-brand.navbar-home');
	if (!brand) return;

	// Replace or insert the logo image before the first child
	var existing = brand.querySelector('img.app-logo, img.navbar-logo');
	if (existing) {
		existing.src = logo;
		existing.alt = frappe.boot.company_name || '';
	} else {
		var img = document.createElement('img');
		img.src = logo;
		img.alt = frappe.boot.company_name || '';
		img.style.cssText = 'height:30px;width:auto;object-fit:contain;margin-right:6px;vertical-align:middle;';
		// hide existing svg/icon inside the brand link
		var icon = brand.querySelector('svg, .app-icon');
		if (icon) icon.style.display = 'none';
		brand.insertBefore(img, brand.firstChild);
	}
});
