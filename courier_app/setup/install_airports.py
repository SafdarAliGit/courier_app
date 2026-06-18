import frappe


AIRPORTS = [
    ("Dubai International Airport", "DXB", "Dubai", "United Arab Emirates"),
    ("Abu Dhabi International Airport", "AUH", "Abu Dhabi", "United Arab Emirates"),
    ("Sharjah International Airport", "SHJ", "Sharjah", "United Arab Emirates"),
    ("Al Maktoum International Airport", "DWC", "Dubai", "United Arab Emirates"),
    ("Allama Iqbal International Airport", "LHE", "Lahore", "Pakistan"),
    ("Jinnah International Airport", "KHI", "Karachi", "Pakistan"),
    ("Islamabad International Airport", "ISB", "Islamabad", "Pakistan"),
    ("Sialkot International Airport", "SKT", "Sialkot", "Pakistan"),
    ("Multan International Airport", "MUX", "Multan", "Pakistan"),
    ("Faisalabad International Airport", "LYP", "Faisalabad", "Pakistan"),
    ("Peshawar Bacha Khan International Airport", "PEW", "Peshawar", "Pakistan"),
    ("Quetta International Airport", "UET", "Quetta", "Pakistan"),
    ("Heathrow Airport", "LHR", "London", "United Kingdom"),
    ("Gatwick Airport", "LGW", "London", "United Kingdom"),
    ("Manchester Airport", "MAN", "Manchester", "United Kingdom"),
    ("Birmingham Airport", "BHX", "Birmingham", "United Kingdom"),
    ("Edinburgh Airport", "EDI", "Edinburgh", "United Kingdom"),
    ("Belfast International Airport", "BFS", "Belfast", "United Kingdom"),
    ("Stansted Airport", "STN", "London", "United Kingdom"),
    ("Luton Airport", "LTN", "London", "United Kingdom"),
    ("John F. Kennedy International Airport", "JFK", "New York", "United States"),
    ("Los Angeles International Airport", "LAX", "Los Angeles", "United States"),
    ("O'Hare International Airport", "ORD", "Chicago", "United States"),
    ("Hartsfield-Jackson Atlanta International Airport", "ATL", "Atlanta", "United States"),
    ("Dallas/Fort Worth International Airport", "DFW", "Dallas", "United States"),
    ("San Francisco International Airport", "SFO", "San Francisco", "United States"),
    ("Miami International Airport", "MIA", "Miami", "United States"),
    ("Newark Liberty International Airport", "EWR", "Newark", "United States"),
    ("King Abdulaziz International Airport", "JED", "Jeddah", "Saudi Arabia"),
    ("King Khalid International Airport", "RUH", "Riyadh", "Saudi Arabia"),
    ("King Fahd International Airport", "DMM", "Dammam", "Saudi Arabia"),
    ("Hamad International Airport", "DOH", "Doha", "Qatar"),
    ("Bahrain International Airport", "BAH", "Manama", "Bahrain"),
    ("Kuwait International Airport", "KWI", "Kuwait City", "Kuwait"),
    ("Muscat International Airport", "MCT", "Muscat", "Oman"),
    ("Istanbul Airport", "IST", "Istanbul", "Turkey"),
    ("Charles de Gaulle Airport", "CDG", "Paris", "France"),
    ("Frankfurt Airport", "FRA", "Frankfurt", "Germany"),
    ("Amsterdam Schiphol Airport", "AMS", "Amsterdam", "Netherlands"),
    ("Zurich Airport", "ZRH", "Zurich", "Switzerland"),
    ("Singapore Changi Airport", "SIN", "Singapore", "Singapore"),
    ("Hong Kong International Airport", "HKG", "Hong Kong", "China"),
    ("Beijing Capital International Airport", "PEK", "Beijing", "China"),
    ("Shanghai Pudong International Airport", "PVG", "Shanghai", "China"),
    ("Narita International Airport", "NRT", "Tokyo", "Japan"),
    ("Incheon International Airport", "ICN", "Seoul", "South Korea"),
    ("Kuala Lumpur International Airport", "KUL", "Kuala Lumpur", "Malaysia"),
    ("Suvarnabhumi Airport", "BKK", "Bangkok", "Thailand"),
    ("Indira Gandhi International Airport", "DEL", "New Delhi", "India"),
    ("Chhatrapati Shivaji Maharaj International Airport", "BOM", "Mumbai", "India"),
    ("Sydney Kingsford Smith Airport", "SYD", "Sydney", "Australia"),
    ("Toronto Pearson International Airport", "YYZ", "Toronto", "Canada"),
    ("Cairo International Airport", "CAI", "Cairo", "Egypt"),
    ("Johannesburg OR Tambo International Airport", "JNB", "Johannesburg", "South Africa"),
]


def execute():
    for airport_name, iata_code, city, country in AIRPORTS:
        if frappe.db.exists("Airport", airport_name):
            continue
        doc = frappe.new_doc("Airport")
        doc.airport_name = airport_name
        doc.iata_code = iata_code
        doc.city = city
        doc.country = country
        doc.insert(ignore_permissions=True)
    frappe.db.commit()
