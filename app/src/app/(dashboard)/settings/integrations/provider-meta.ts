export const PROVIDER_META: Record<
  string,
  {
    label: string;
    description: string;
    fields: { key: string; label: string; placeholder?: string }[];
    supportsTest?: boolean;
  }
> = {
  freshdesk: {
    label: "Freshdesk",
    description: "Helpdesk ticketing — creates tickets from journey actions and syncs ticket updates.",
    fields: [
      { key: "domain", label: "Domain", placeholder: "yourcompany (as in yourcompany.freshdesk.com)" },
      { key: "apiKey", label: "API Key" },
    ],
    supportsTest: true,
  },
  exotel: {
    label: "Exotel",
    description: "Cloud telephony — initiate calls from Supportify and log call outcomes to the timeline.",
    fields: [
      { key: "sid", label: "Account SID" },
      { key: "apiKey", label: "API Key" },
      { key: "apiToken", label: "API Token" },
      { key: "callerId", label: "Exophone (Caller ID)" },
    ],
    supportsTest: true,
  },
  clevertap: {
    label: "Clevertap",
    description: "Customer engagement platform — syncs lead profiles and ingests campaign events.",
    fields: [
      { key: "accountId", label: "Account ID" },
      { key: "passcode", label: "Passcode" },
      { key: "region", label: "Region (optional)", placeholder: "eu1, sg1... leave blank for default" },
    ],
    supportsTest: true,
  },
  whatsapp_meta: {
    label: "WhatsApp (Meta Cloud API)",
    description: "Send WhatsApp template messages and receive replies, manually or from journeys.",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID" },
      { key: "accessToken", label: "Access Token" },
    ],
    supportsTest: false,
  },
  sms_exotel: {
    label: "SMS (Exotel)",
    description: "Send SMS messages to leads, manually or from journeys.",
    fields: [
      { key: "sid", label: "Account SID" },
      { key: "apiKey", label: "API Key" },
      { key: "apiToken", label: "API Token" },
      { key: "senderId", label: "Sender ID" },
    ],
    supportsTest: false,
  },
  resend_email: {
    label: "Resend (Email)",
    description: "Transactional email — notifies Admins and the assigned RM when a client's stage SLA is breached.",
    fields: [
      { key: "apiKey", label: "API Key" },
      { key: "fromAddress", label: "From Address", placeholder: "alerts@yourdomain.com" },
      { key: "fromName", label: "From Name (optional)", placeholder: "Supportify Alerts" },
    ],
    supportsTest: false,
  },
};
