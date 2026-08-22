// Synthetic Growth G1 pilot fixture. Not real prospects. Never use for outreach.
// 24 records: 12 Ontario / 12 Arizona across the eight original target cities.

const rows = [
  ["PILOT-ON-001","Ontario","Toronto","Office Directories","Harbourline Office Centre","office","https://harbourline-office.example.invalid","416-555-0101","100 King Street W","Complete office profile for review"],
  ["PILOT-ON-002","Ontario","Toronto","Medical Directories","Lakeview Dental Group","dental office","https://lakeview-dental.example.invalid","416-555-0102","200 University Avenue","Dental office ICP"],
  ["PILOT-ON-003","Ontario","Toronto","Property Manager Lists","Northcrest Property Management","property management","https://northcrest-pm.example.invalid","416-555-0103","300 Bay Street","Property management ICP"],
  ["PILOT-ON-004","Ontario","Mississauga","Property Manager Lists","Apex Managed Properties","property management","https://apex-managed.example.invalid","905-555-0111","10 City Centre Drive","Exact duplicate baseline"],
  ["PILOT-ON-005","Ontario","Mississauga","Google Maps","Apex Managed Properties Inc.","property management","https://apex-managed.example.invalid","905-555-0111","10 City Centre Drive","Intentional exact duplicate of PILOT-ON-004"],
  ["PILOT-ON-006","Ontario","Mississauga","Medical Directories","Credit Valley Medical Offices","medical office","https://credit-valley-med.example.invalid","905-555-0112","20 Hurontario Street","Medical office ICP"],
  ["PILOT-ON-007","Ontario","Brampton","Industrial Parks","Queen Industrial Offices","industrial-office","https://queen-industrial.example.invalid","905-555-0121","30 Queen Street E","Industrial-office ICP"],
  ["PILOT-ON-008","Ontario","Brampton","Office Directories","Peel Corporate Suites","corporate office","https://peel-corporate.example.invalid","905-555-0122","40 Main Street N","Corporate office ICP"],
  ["PILOT-ON-009","Ontario","Brampton","Property Manager Lists","Maple Residential Management","property management","https://maple-residential.example.invalid","905-555-0123","50 Kennedy Road","Property management ICP"],
  ["PILOT-ON-010","Ontario","Vaughan","Industrial Parks","Concord Commerce Offices","industrial office","https://concord-commerce.example.invalid","905-555-0131","60 Highway 7","Industrial-office ICP"],
  ["PILOT-ON-011","Ontario","Vaughan","Medical Directories","Vaughan Health Centre","clinic","https://vaughan-health.example.invalid","905-555-0132","70 Jane Street","Clinic ICP"],
  ["PILOT-ON-012","Ontario","Vaughan","Property Manager Lists","Northcrest Property Management - Vaughan","property management","https://northcrest-pm.example.invalid","905-555-0133","80 Rutherford Road","Intentional shared-domain probable duplicate scenario"],

  ["PILOT-AZ-001","Arizona","Phoenix","Office Directories","Central Phoenix Business Center","office","https://central-phx.example.invalid","602-555-0201","100 N Central Avenue","Office ICP"],
  ["PILOT-AZ-002","Arizona","Phoenix","Medical Directories","Desert Medical Pavilion","medical office","https://desert-med.example.invalid","602-555-0202","200 E Van Buren Street","Medical office ICP"],
  ["PILOT-AZ-003","Arizona","Phoenix","Property Manager Lists","Sonoran Property Partners","property management","https://sonoran-property.example.invalid","602-555-0203","300 W Washington Street","Property management ICP"],
  ["PILOT-AZ-004","Arizona","Scottsdale","Office Directories","Airpark Executive Offices","corporate office","https://airpark-exec.example.invalid","480-555-0211","100 N Scottsdale Road","Corporate office ICP"],
  ["PILOT-AZ-005","Arizona","Scottsdale","Medical Directories","Scottsdale Dental Pavilion","dental office","https://scottsdale-dental.example.invalid","480-555-0212","200 E Camelback Road","Dental ICP"],
  ["PILOT-AZ-006","Arizona","Scottsdale","Property Manager Lists","Cactus Multi-Property Management","multi-property operator","https://cactus-multi.example.invalid","480-555-0213","300 N Hayden Road","Multi-property ICP"],
  ["PILOT-AZ-007","Arizona","Tempe","Industrial Parks","Tempe Commerce Campus","industrial-office","https://tempe-commerce.example.invalid","480-555-0221","100 S Mill Avenue","Industrial-office ICP"],
  ["PILOT-AZ-008","Arizona","Tempe","Medical Directories","Mill Avenue Medical Offices","clinic","https://mill-medical.example.invalid","480-555-0222","200 S Rural Road","Clinic ICP"],
  ["PILOT-AZ-009","Arizona","Tempe","Property Manager Lists","Desert Stay Portfolio","vacation rental","https://desert-stay.example.invalid","480-555-0223","300 E University Drive","Vacation-rental ICP"],
  ["PILOT-AZ-010","Arizona","Mesa","Industrial Parks","Mesa Gateway Offices","industrial office","https://mesa-gateway.example.invalid","480-555-0231","100 E Main Street","Industrial-office ICP"],
  ["PILOT-AZ-011","Arizona","Mesa","Office Directories","East Valley Corporate Center","general office","https://east-valley-corp.example.invalid","480-555-0232","200 S Country Club Drive","General office ICP"],
  ["PILOT-AZ-012","Arizona","Mesa","Property Manager Lists","Sonoran Property Partners - Mesa","property management","https://sonoran-property.example.invalid","480-555-0233","300 N Mesa Drive","Intentional shared-domain probable duplicate scenario"],
];

export const G1_PILOT_FIXTURE = rows.map(([id, market, city, sourceLane, company, segment, website, phone, address, notes]) => ({
  "Lead ID": id,
  "Market": market,
  "City": city,
  "Source Lane": sourceLane,
  "Company / Building": company,
  "Segment": segment,
  "Website": website,
  "Phone": phone,
  "Address": address,
  "Raw Notes": `${notes}. SYNTHETIC ACCEPTANCE FIXTURE — NOT FOR OUTREACH.`,
  "Captured By": "growth-g1-pilot-fixture",
  "Verification Status": "unverified",
  "Ready for Review": "No"
}));

export const G1_PILOT_EXPECTATIONS = Object.freeze({
  total: 24,
  ontario: 12,
  arizona: 12,
  cities: ["Toronto","Mississauga","Brampton","Vaughan","Phoenix","Scottsdale","Tempe","Mesa"],
  exactDuplicatePair: ["PILOT-ON-004","PILOT-ON-005"],
  sharedDomainPairs: [
    ["PILOT-ON-003","PILOT-ON-012"],
    ["PILOT-AZ-003","PILOT-AZ-012"]
  ],
  outboundAllowed: false
});
