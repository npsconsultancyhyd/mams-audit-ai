// Master data created on first run (edit later inside the app)
export const DEFAULT_TARIFF = [
  ['General Ward','Room',1500,false],['Semi Private','Room',2500,false],['Special Room','Room',3000,true],['Deluxe Room','Room',3500,true],
  ['ICU / day','ICU',8000,false],['OT Major','OT',18000,false],['OT Minor','OT',8000,false],
  ['Surgeon Major','Surgeon',25000,false],['Surgeon Minor','Surgeon',10000,false],['Consultation / day','Consultation',800,false],
  ['CT Brain','Radiology',2500,false],['MRI Spine','Radiology',6000,false],['X-Ray Chest','Radiology',400,false],['USG Abdomen','Radiology',1200,false],['2D Echo','Radiology',2000,false],
  ['Knee Prosthesis (TKR)','Implant',95000,false],['Hip Prosthesis','Implant',85000,false],['Cardiac Stent (DES)','Implant',45000,false],['Interlocking Nail','Implant',18000,false],['Bone Plate & Screws','Implant',14000,false],['Hernia Mesh','Implant',6000,false],['IOL Foldable','Implant',12000,false],['Pacemaker (Single Chamber)','Implant',75000,false],
  ['CBC','Lab',350,false],['LFT','Lab',700,false],['RFT','Lab',650,false],['Blood Sugar','Lab',150,false],['Serology','Lab',900,false],['ECG','Lab',300,false]
].map(([service,category,price,premium])=>({service,category,price,premium}));
export const DEFAULT_PACKAGES = [
  ['AS-ORT-01','Total Knee Replacement','Orthopaedics','Aarogyasri',80000],['AS-ORT-02','Fracture Femur – ORIF','Orthopaedics','Aarogyasri',45000],
  ['AS-GS-01','Lap Cholecystectomy','General Surgery','Aarogyasri',35000],['AS-GS-02','Inguinal Hernia Repair','General Surgery','Aarogyasri',25000],
  ['AS-CAR-01','PTCA – Single Stent','Cardiology','Aarogyasri',95000],['AS-CAR-02','Coronary Angiogram','Cardiology','Aarogyasri',12000],
  ['AS-NEU-01','Craniotomy','Neurosurgery','Aarogyasri',110000],['AS-OBG-01','LSCS','OBG','Aarogyasri',22000],['AS-GM-01','Medical Management – ICU','General Medicine','Aarogyasri',30000],
  ['INS-ORT-01','Total Knee Replacement','Orthopaedics','Insurance',150000],['INS-ORT-02','Fracture Femur – ORIF','Orthopaedics','Insurance',90000],
  ['INS-GS-01','Lap Cholecystectomy','General Surgery','Insurance',60000],['INS-GS-02','Inguinal Hernia Repair','General Surgery','Insurance',50000],
  ['INS-CAR-01','PTCA – Single Stent','Cardiology','Insurance',180000],['INS-NEU-01','Craniotomy','Neurosurgery','Insurance',200000],
  ['INS-OBG-01','LSCS','OBG','Insurance',45000],['INS-GM-01','Medical Management','General Medicine','Insurance',50000]
].map(([code,name,dept,scheme,amount])=>({code,name,dept,scheme,amount}));

export const DEFAULT_SETTINGS = {
  hospitalName: process.env.HOSPITAL_NAME || 'MAMS Hospital',
  model: process.env.OPENAI_MODEL || 'gpt-5-mini',
  uplift: 25,      // % uplift on OT & surgeon charges for premium rooms
  tolerance: 1,    // rupee rounding tolerance
  riskHigh: 10     // % over package that counts as High approval risk
};
