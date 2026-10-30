// Public website content (Brand Kit, October 2026: "Voice AI for the trades"). The copy follows
// the approved design; claims are kept to what the product does today.

export const BRAND = {
  workGreen: "#1F3B2D",
  deepGreen: "#173022",
  duckTan: "#D8B47A",
  tanDeep: "#A87A33",
  bark: "#6B5A43",
  canvas: "#EFE6D4",
  signal: "#A8401F",
} as const;

export const PRICING = { monthly: 139, includedMinutes: 200, blockMinutes: 100, blockPrice: 25, minimumMonths: 3 } as const;

/** The Follow-Up Agent add-on's monthly price; null shows "ask us" until it's set. */
export const FOLLOWUP_ADDON_PRICE: number | null = null;

/** What the Follow-Up Agent does for each trade: a website form, then a call within minutes. */
export const FOLLOWUP_EXAMPLES: Record<TradeKey, { form: string; call: string; booked: string }> = {
  contractors: { form: "“Need a quote to replace our back deck, about 300 sq ft.”", call: "Confirms the size, decking material, timeline and address.", booked: "Site visit booked Thursday 4:30 PM. Lead and notes texted to you." },
  mechanics: { form: "“Check engine light on my 2017 Civic. Can I get it looked at?”", call: "Asks about symptoms and mileage, explains the diagnostic.", booked: "Drop-off booked tomorrow 8:00 AM. Customer gets a confirmation text." },
  retail: { form: "“Do you do bike fittings? Looking at a new road bike.”", call: "Asks about riding style and budget, shares fitting options.", booked: "Fitting booked Saturday 11:00 AM. Store gets the details by text." },
};

export type TradeKey = "contractors" | "mechanics" | "retail";
export type Scenario = "customer" | "supplier";
export type Line = { speaker: "AI Dispatcher" | "Caller"; text: string };
export type SampleCall = { caller: string; badge: string; transcript: Line[]; smsToOwner: string; smsToClient: string; clientLabel: string };

export type Industry = {
  id: TradeKey;
  path: string;
  tabLabel: string;
  shortLabel: string;
  eyebrow: string;
  heroTitle: string;
  heroSub: string;
  primaryCta: string;
  tierName: string;
  trustBadges: string[];
  painPoints: { title: string; desc: string }[];
  steps: { step: string; action: string; outcome: string }[];
  featuresTitle: string;
  features: { title: string; desc: string }[];
  simulation: Record<Scenario, SampleCall>;
  seo: { title: string; description: string };
};

export const INDUSTRIES: Record<TradeKey, Industry> = {
  contractors: {
    id: "contractors",
    path: "/contractors",
    tabLabel: "Contractors & Trades",
    shortLabel: "Contractors",
    eyebrow: "Voice AI for general contractors & field trades",
    heroTitle: "Up on a ladder or running power tools? We answer every lead.",
    heroSub:
      "Head Above Digital gives general contractors, plumbers, electricians, and roofers a 24/7 AI receptionist that answers every call, books the estimate, and texts you the address—so you can stay on the tools.",
    primaryCta: "Book a Live Demo",
    tierName: "Trade Pro Tier",
    trustBadges: ["Zero Missed Calls", "Hands-Free Lead Capture", "Built for Field Work"],
    painPoints: [
      { title: "No More Pausing the Job", desc: "Stop shutting off saws or climbing down scaffolding just to answer price shoppers. The AI handles inquiries naturally and books qualified estimates." },
      { title: "24/7 After-Hours Lead Capture", desc: "Emergency leak, heating failure, or weekend storm damage calls get answered instantly, stopping clients from calling the next contractor on Google." },
      { title: "Automated Appointment Booking", desc: "Collects project scope, address, and job timeline, reserving on-site consultation windows straight onto your calendar." },
      { title: "Smart Sub-Trade & Vendor Routing", desc: "Tells lumber yards, parts suppliers, and sub-trades apart from homeowner leads—routing urgent job-site calls straight to your cell while logging general inquiries." },
    ],
    steps: [
      { step: "Step 1: Instant Answering", action: "24/7 call pickup", outcome: "Zero dropped calls or lost revenue during noisy jobs or driving between sites." },
      { step: "Step 2: Intelligent Intake & Scheduling", action: "Job scope qualification & booking", outcome: "Collects job description, project location, and books on-site estimate slots into your calendar." },
      { step: "Step 3: Instant SMS Notification", action: "Automated text messages", outcome: "Caller gets an immediate SMS confirmation with estimate date and time; you get a live lead summary by text." },
      { step: "Step 4: Tailored Onboarding & Workflow Setup", action: "White-glove setup", outcome: "We build your call flow, connect your Google Calendar, and test your line so dispatch works from day one." },
    ],
    featuresTitle: "Built for the Job Site",
    features: [
      { title: "Instant Client SMS & Address Dispatch", desc: "The moment a call wraps, the homeowner gets a confirmation text and you get the job scope, address, and callback number on your phone." },
      { title: "Subcontractor & Supplier Filtering", desc: "Inspectors, supply houses, and your crew bypass the customer booking script and ring through to your cell." },
      { title: "Calendar Sync", desc: "Checks your real openings before it books, so nothing gets double-booked while you are out in the field." },
      { title: "Direct Phone Support for Changes", desc: "Booked out for three weeks? Call us and we adjust your booking window or seasonal hours the same day." },
    ],
    simulation: {
      customer: {
        caller: "Homeowner — Panel Upgrade & EV Charger Quote",
        badge: "New estimate booked",
        clientLabel: "Instant SMS to caller",
        transcript: [
          { speaker: "AI Dispatcher", text: "Thanks for calling Atwell Peak Contracting. The crew is on a job site right now, but I can book an estimate or get a message to the foreman. How can I help?" },
          { speaker: "Caller", text: "Hi, we need a 200-amp panel upgrade and an EV charger installed in our garage. Looking to get a quote." },
          { speaker: "AI Dispatcher", text: "We handle 200-amp upgrades every week. What is the street address, and does Thursday at 8:00 AM or Friday at 3:30 PM work for a 20-minute site walkthrough?" },
          { speaker: "Caller", text: "38030 7th Ave. Thursday at 8:00 AM works great." },
          { speaker: "AI Dispatcher", text: "You are locked in for Thursday at 8:00 AM. I just texted you the confirmation details." },
        ],
        smsToOwner: "NEW ESTIMATE BOOKED: 200A Panel + EV Charger | Address: 38030 7th Ave | Slot: Thu 8:00 AM | Caller: Mark (604-555-0192)",
        smsToClient: "Confirmed: Atwell Peak Contracting will be at 38030 7th Ave on Thu at 8:00 AM for your panel & EV charger estimate. Reply to this text if you need to change the time.",
      },
      supplier: {
        caller: "Wholesale Electrical Supply — Delivery Driver",
        badge: "Supplier routed to foreman",
        clientLabel: "Call log",
        transcript: [
          { speaker: "AI Dispatcher", text: "Thanks for calling Atwell Peak Contracting. How can I help you today?" },
          { speaker: "Caller", text: "Hey, this is Dave from Gescan Supply. I have the 200-amp meter base and wire order on the truck—need to know which site gate to drop at." },
          { speaker: "AI Dispatcher", text: "Got it, Dave. Putting you straight through to the site foreman's cell right now." },
        ],
        smsToOwner: "SUPPLIER TRANSFER: Dave @ Gescan Supply calling re: 200A meter base drop location. Routing to your mobile now.",
        smsToClient: "Supplier call identified (Gescan Supply) → forwarded to foreman's cell (0m 14s).",
      },
    },
    seo: {
      title: "AI Voice Receptionist for Contractors & Trades",
      description: "24/7 AI voice receptionist and lead management for contractors, electricians, plumbers and roofers. Books estimates into your calendar and texts you every lead. $139/month.",
    },
  },
  mechanics: {
    id: "mechanics",
    path: "/auto-repair",
    tabLabel: "Auto Repair & Mechanics",
    shortLabel: "Auto Shops",
    eyebrow: "Voice AI for auto repair shops & mechanics",
    heroTitle: "Stuck under the hood? We'll answer the calls.",
    heroSub:
      "Head Above Digital gives auto shops a 24/7 AI receptionist that answers every call, logs vehicle year/make/model, books bay drop-offs, and sends parts suppliers straight to the counter.",
    primaryCta: "Book a Shop Demo",
    tierName: "Auto Pro Tier",
    trustBadges: ["No More Dropping Tools", "Year / Make / Model Intake", "Parts Counter Routing"],
    painPoints: [
      { title: "No More Dropping Tools", desc: "Stop wiping grease off your hands or climbing out from under a hoist just to answer routine pricing, oil change, or scheduling questions." },
      { title: "24/7 Appointment Booking", desc: "Capture after-hours breakdowns and service requests directly into your shop calendar without lifting a finger." },
      { title: "Supplier vs. Customer Routing", desc: "The AI identifies NAPA, Lordco, and wholesale parts drivers and routes them straight to the parts counter or bay manager while booking customer drop-offs." },
      { title: "Zero Missed Opportunities", desc: "While you are under a car, running diagnostics, or test-driving a vehicle, every caller gets an immediate, plain-spoken response." },
    ],
    steps: [
      { step: "Step 1: Immediate Answer", action: "Instant call intake", outcome: "Calls picked up right away with zero hold time or voicemail." },
      { step: "Step 2: Triage & Bay Scheduling", action: "Vehicle & symptom qualification", outcome: "Captures vehicle year, make, model, and symptoms; schedules drop-off times or forwards parts vendors." },
      { step: "Step 3: SMS Confirmation & Alerts", action: "Dispatch alerts", outcome: "Customer gets an instant SMS with drop-off details; the shop gets real-time SMS and email job alerts." },
      { step: "Step 4: Tailored Shop Onboarding", action: "Custom shop configuration", outcome: "Set up around your bay schedule, your services and your calendar, and tested before it goes live." },
    ],
    featuresTitle: "Features Built for Auto Shops",
    features: [
      { title: "Intelligent Supplier Filtering", desc: "Parts delivery drivers and wholesale suppliers skip the customer booking questions and transfer straight to the back office or parts desk." },
      { title: "Every Call Summarised", desc: "Recordings, transcripts and a short summary of every call in your dashboard, with weekly and monthly reports emailed to you." },
      { title: "Calendar Booking", desc: "Books drop-offs into your Google Calendar with the vehicle year/make/model and the work requested." },
      { title: "Dedicated Phone Support for Setup & Adjustments", desc: "White-glove onboarding and continuous updates. Adjust operating hours, bay availability, or routing rules with a quick phone call." },
    ],
    simulation: {
      customer: {
        caller: "Vehicle Owner — Brake Grind & Inspection",
        badge: "Bay drop-off booked",
        clientLabel: "Instant SMS to caller",
        transcript: [
          { speaker: "AI Dispatcher", text: "Thanks for calling Sea-to-Sky Auto & Truck. The techs are in the bays right now, but I can book your vehicle in. What can I help you with?" },
          { speaker: "Caller", text: "My 2022 Ram 1500 has a grinding noise on the front passenger brakes. Can I bring it in tomorrow morning?" },
          { speaker: "AI Dispatcher", text: "We can get your 2022 Ram 1500 on the hoist tomorrow. Drop-off is at 8:30 AM, and we will call you with the brake inspection quote before turning a wrench. What is your name?" },
          { speaker: "Caller", text: "Tyler. 8:30 AM drop-off works." },
          { speaker: "AI Dispatcher", text: "All set, Tyler. I just sent a text with our key-drop instructions for tomorrow at 8:30 AM." },
        ],
        smsToOwner: "NEW BAY BOOKING: 2022 Ram 1500 | Issue: Front passenger brake grind | Drop-off: Tomorrow 8:30 AM | Customer: Tyler (604-555-0148)",
        smsToClient: "Confirmed: Drop off your 2022 Ram 1500 at Sea-to-Sky Auto tomorrow at 8:30 AM. Park in bays 1-4 and leave keys at the front desk.",
      },
      supplier: {
        caller: "Lordco Auto Parts — Rotor Delivery",
        badge: "Routed to parts desk",
        clientLabel: "Call log",
        transcript: [
          { speaker: "AI Dispatcher", text: "Thanks for calling Sea-to-Sky Auto & Truck. How can I help?" },
          { speaker: "Caller", text: "Hi, it's Sam at the Lordco parts desk calling back with the caliper and rotor availability on PO 4412." },
          { speaker: "AI Dispatcher", text: "Thanks Sam. Sending you straight through to the parts counter now." },
        ],
        smsToOwner: "PARTS DESK TRANSFER: Lordco Parts calling re: PO #4412 caliper/rotor stock. Connected to the parts counter.",
        smsToClient: "Wholesale vendor identified (Lordco Auto Parts) → transferred to parts counter (0m 11s).",
      },
    },
    seo: {
      title: "AI Receptionist for Auto Repair Shops & Mechanics",
      description: "24/7 AI voice receptionist for auto repair shops. Logs year/make/model, books bay drop-offs, routes parts suppliers and texts customers a confirmation. $139/month.",
    },
  },
  retail: {
    id: "retail",
    path: "/retail",
    tabLabel: "Small Business & Retail",
    shortLabel: "Retail & Shops",
    eyebrow: "Voice AI for storefronts, salons & local shops",
    heroTitle: "Ringing phones while serving customers in line? Never miss another sale.",
    heroSub:
      "Head Above Digital gives local storefronts, specialty shops, and service counters a 24/7 AI receptionist that answers routine questions, books consultations, and routes delivery couriers—so your team stays focused on the customer standing in front of them.",
    primaryCta: "Book a Storefront Demo",
    tierName: "Storefront Pro Tier",
    trustBadges: ["Zero Line Interruptions", "24/7 Front Desk AI", "Hands-Free SMS Booking"],
    painPoints: [
      { title: "In-Store Interruption Overload", desc: "Stop walking away from the register or a paying customer just to answer repetitive phone questions about directions, parking, or store hours." },
      { title: "After-Hours Revenue Loss", desc: "Customers call in the evening and on weekends. Instead of hitting voicemail, calls are answered right away—booking appointments and taking messages." },
      { title: "Automated Appointment & Fitting Booking", desc: "Books private consultations, fitting sessions, repair drop-offs, or service slots straight into your calendar." },
      { title: "Vendor vs. Shopper Smart Triage", desc: "Tells everyday shoppers apart from freight couriers, distributor reps, and stock deliveries—routing shipments straight to the back room." },
    ],
    steps: [
      { step: "Step 1: Instant Intake", action: "24/7 natural conversational pickup", outcome: "Zero dropped calls or abandoned inquiries during busy Saturday rushes or after closing." },
      { step: "Step 2: Intelligent Triage & Scheduling", action: "FAQ answers & appointment booking", outcome: "Answers store hours, location, and store policies while booking consultation slots directly to your calendar." },
      { step: "Step 3: Instant SMS Confirmation", action: "Automated text message notification", outcome: "Caller immediately receives SMS appointment details and parking instructions; the manager gets a call summary." },
      { step: "Step 4: Tailored White-Glove Onboarding", action: "Custom storefront configuration", outcome: "We write your call scripts, connect your calendar, and handle phone routing for you." },
    ],
    featuresTitle: "Storefront-Specific Capabilities",
    features: [
      { title: "Instant SMS Confirmations", desc: "Texts customers booking confirmations, store directions, and arrival instructions the second they hang up." },
      { title: "Caller Follow-Up Texts", desc: "Every caller can get a short text recap of what was agreed, so nobody leaves a call unsure what happens next." },
      { title: "Smart Supplier & Courier Filtering", desc: "Freight deliveries and wholesale stock shipments are forwarded straight to backroom staff, keeping front lines clear." },
      { title: "Calendar Booking", desc: "Checks real openings before it books, preventing double-booking across fitting rooms, service bays, or consultation desks." },
    ],
    simulation: {
      customer: {
        caller: "Customer — Custom Boot Fitting",
        badge: "Consultation booked",
        clientLabel: "Instant SMS to caller",
        transcript: [
          { speaker: "AI Dispatcher", text: "Thanks for calling Garibaldi Outdoor & Gear. Our staff is helping customers at the counter right now, but I can check store hours or book a gear fitting." },
          { speaker: "Caller", text: "Hi! Do you guys do custom boot fittings on Saturdays, and how late are you open?" },
          { speaker: "AI Dispatcher", text: "We are open 9:00 AM to 6:00 PM on Saturdays. I have a 45-minute custom boot fitting slot open this Saturday at 11:00 AM or 2:00 PM. Which one works for you?" },
          { speaker: "Caller", text: "Saturday at 11:00 AM please. My name is Sarah." },
          { speaker: "AI Dispatcher", text: "You are booked for Saturday at 11:00 AM, Sarah. I just texted you a confirmation and parking details." },
        ],
        smsToOwner: "NEW STORE BOOKING: Custom Boot Fitting (45m) | Slot: Sat 11:00 AM | Customer: Sarah (604-555-0174)",
        smsToClient: "Confirmed: Custom Boot Fitting at Garibaldi Outdoor this Saturday at 11:00 AM. Free customer parking is behind the building off Cleveland Ave.",
      },
      supplier: {
        caller: "Freight Courier — Pallet Delivery",
        badge: "Routed to stockroom",
        clientLabel: "Call log",
        transcript: [
          { speaker: "AI Dispatcher", text: "Thanks for calling Garibaldi Outdoor & Gear. How can I help?" },
          { speaker: "Caller", text: "This is Manitoulin Transport. I'm in the alley with two pallets of winter inventory—need someone to open the receiving door." },
          { speaker: "AI Dispatcher", text: "Got it. Transferring you straight to the receiving and stockroom line now." },
        ],
        smsToOwner: "RECEIVING ALERT: Manitoulin Transport at the back alley door with 2 pallets. Ringing the stockroom line.",
        smsToClient: "Freight courier identified (Manitoulin Transport) → routed to stockroom (0m 09s).",
      },
    },
    seo: {
      title: "AI Receptionist for Retail Stores & Small Businesses",
      description: "24/7 AI voice receptionist for storefronts, salons and local shops. Answers store hours and questions, books appointments, routes deliveries and texts confirmations. $139/month.",
    },
  },
};

export const TRADE_KEYS = Object.keys(INDUSTRIES) as TradeKey[];

// ElevenLabs built-in voices (available in every account): a different receptionist for each
// trade and a different caller for each sample call.
export const SAMPLE_VOICES: Record<TradeKey, { dispatcher: string; customer: string; supplier: string }> = {
  contractors: { dispatcher: "cgSgspJ2msm6clMCkdW9" /* Jessica */, customer: "iP95p4xoKVk53GoZ742B" /* Chris */, supplier: "pqHfZKP75CvOlQylNhV4" /* Bill */ },
  mechanics: { dispatcher: "cjVigY5qzO86Huf0OWal" /* Eric */, customer: "bIHbv24MWmeRgasZH58o" /* Will */, supplier: "CwhRBWXzGAHq8TQ4Fs17" /* Roger */ },
  retail: { dispatcher: "EXAVITQu4vr4xnVDxQaL" /* Sarah */, customer: "FGY2WhTYpPnrIDTdsKH5" /* Laura */, supplier: "nPczCjzI2devNBz1zQrb" /* Brian */ },
};
/** Used if one of the voices above isn't available to the account. */
export const FALLBACK_VOICES = { dispatcher: "cjVigY5qzO86Huf0OWal", caller: "iP95p4xoKVk53GoZ742B" };
