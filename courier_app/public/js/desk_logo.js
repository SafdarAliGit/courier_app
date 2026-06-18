$(function () {
	var logo = frappe.boot && frappe.boot.company_logo;
	if (!logo) return;

	var brand = document.querySelector('.navbar-header .navbar-home, .navbar-brand.navbar-home');
	if (!brand) return;

	var existing = brand.querySelector('img.app-logo, img.navbar-logo');
	if (existing) {
		existing.src = logo;
		existing.alt = frappe.boot.company_name || '';
	} else {
		var img = document.createElement('img');
		img.src = logo;
		img.alt = frappe.boot.company_name || '';
		img.style.cssText = 'height:30px;width:auto;object-fit:contain;margin-right:6px;vertical-align:middle;';
		var icon = brand.querySelector('svg, .app-icon');
		if (icon) icon.style.display = 'none';
		brand.insertBefore(img, brand.firstChild);
	}
});
