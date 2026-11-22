// The website FAQ (home and industry pages). Each answer must match what the product does and the
// privacy policy says; keep them in step.
import { PRICING } from "./site-content";

export const FAQ: { q: string; a: string }[] = [
  { q: "Will my customers know it's AI?", a: "It answers in your business's name with a natural voice, and most callers just get their question answered or their appointment booked. If anyone asks whether they're talking to a person, it says plainly that it's an AI assistant for your business and offers to take a message or put them through to you. It never pretends to be human." },
  { q: "Can it transfer calls to me?", a: "Yes. You choose who gets put through: urgent jobs, suppliers, your crew or anyone who asks for you. Those calls ring your cell (or whichever number you pick). You can also have your cell ring first during your working hours, so the receptionist only answers the calls you miss." },
  { q: "What if it gets something wrong?", a: "It only answers from what you've told us about your business, and it never makes up prices, availability or policies. If a caller asks something it doesn't know, it takes a message and adds the question to your list, and you get a transcript and summary of every call. Tell us what to change and we update it for you, usually the same day." },
  { q: "Do I keep my business number?", a: "Yes. Forward the calls you miss (or all of them) from the number you already have, or move the number over to us. Customers keep calling the number they know." },
  { q: "Can I cancel?", a: "Yes, any time. There's no contract, no minimum term and no setup fee. You're billed monthly, and the service runs to the end of the month you've paid for. Or pay a year upfront and save 20%: cancel any time and it won't renew, with service to the end of the paid year." },
  { q: "What happens if the AI service has a problem?", a: "Every line has a backup: if the voice service can't take a call, the caller can leave a voicemail that's transcribed and texted to you straight away, and we're alerted. We also check every client's line once a day." },
  { q: "How many calls do the minutes cover?", a: `Your plan includes ${PRICING.includedMinutes} minutes a month. Most calls take one to two minutes, so that's roughly 100 to 200 calls. Past that, minutes are added in ${PRICING.blockMinutes}-minute blocks, and you get a heads-up at 75%.` },
];
