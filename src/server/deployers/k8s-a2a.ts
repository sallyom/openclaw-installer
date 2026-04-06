import * as k8s from "@kubernetes/client-node";
import { readFileSync } from "node:fs";
import type { DeployConfig } from "./types.js";
import type { TreeEntry } from "../state-tree.js";

export const DEFAULT_A2A_REALM = "kagenti";
export const DEFAULT_A2A_KEYCLOAK_NAMESPACE = "keycloak";

const A2A_BRIDGE_PY_BASE64 = "IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMwoiIiJBMkEtdG8tT3BlbkFJIGJyaWRnZSBmb3IgS2FnZW50aSBVSSBjaGF0LgoKVHJhbnNsYXRlcyBBMkEgSlNPTi1SUEMgKG1lc3NhZ2Uvc2VuZCwgbWVzc2FnZS9zdHJlYW0pIGludG8gT3BlbkFJCmNoYXQgY29tcGxldGlvbnMgcmVxdWVzdHMgYWdhaW5zdCB0aGUgbG9jYWwgT3BlbkNsYXcgZ2F0ZXdheSwgYW5kCnRyYW5zbGF0ZXMgdGhlIHJlc3BvbnNlcyBiYWNrIHRvIEEyQSBmb3JtYXQuCgpBbHNvIHNlcnZlcyAvLndlbGwta25vd24vYWdlbnQuanNvbiBhbmQgLy53ZWxsLWtub3duL2FnZW50LWNhcmQuanNvbgpmcm9tIHRoZSBtb3VudGVkIENvbmZpZ01hcCBkaXJlY3RvcnkgZm9yIEthZ2VudGkgb3BlcmF0b3IgZGlzY292ZXJ5LgoKU3RkbGliIG9ubHkgLS0gcnVucyBvbiB1Ymk5OmxhdGVzdCB3aXRoIG5vIHBpcCBwYWNrYWdlcy4KIiIiCgppbXBvcnQganNvbgppbXBvcnQgb3MKaW1wb3J0IHJlCmltcG9ydCB1dWlkCmZyb20gaHR0cC5zZXJ2ZXIgaW1wb3J0IEhUVFBTZXJ2ZXIsIEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIKZnJvbSB1cmxsaWIucmVxdWVzdCBpbXBvcnQgUmVxdWVzdCwgdXJsb3Blbgpmcm9tIHVybGxpYi5lcnJvciBpbXBvcnQgVVJMRXJyb3IsIEhUVFBFcnJvcgoKR0FURVdBWV9VUkwgPSBvcy5lbnZpcm9uLmdldCgiR0FURVdBWV9VUkwiLCAiaHR0cDovL2xvY2FsaG9zdDoxODc4OSIpCkdBVEVXQVlfVE9LRU4gPSBvcy5lbnZpcm9uLmdldCgiR0FURVdBWV9UT0tFTiIsICIiKQpBR0VOVF9JRCA9IG9zLmVudmlyb24uZ2V0KCJBR0VOVF9JRCIsICIiKQpBR0VOVF9DQVJEX0RJUiA9IG9zLmVudmlyb24uZ2V0KCJBR0VOVF9DQVJEX0RJUiIsICIvc3J2Ly53ZWxsLWtub3duIikKTElTVEVOX1BPUlQgPSBpbnQob3MuZW52aXJvbi5nZXQoIkxJU1RFTl9QT1JUIiwgIjgwODAiKSkKCgpkZWYgcmVhZF9hZ2VudF9jYXJkKGZpbGVuYW1lKToKICAgIHBhdGggPSBvcy5wYXRoLmpvaW4oQUdFTlRfQ0FSRF9ESVIsIGZpbGVuYW1lKQogICAgdHJ5OgogICAgICAgIHdpdGggb3BlbihwYXRoKSBhcyBmOgogICAgICAgICAgICByZXR1cm4gZi5yZWFkKCkKICAgIGV4Y2VwdCBGaWxlTm90Rm91bmRFcnJvcjoKICAgICAgICByZXR1cm4gTm9uZQoKCmRlZiBleHRyYWN0X3NlbmRlcl9pZChodHRwX2hlYWRlcnMpOgogICAgIiIiRGVyaXZlIGEgc3RhYmxlIHNlbmRlciBpZGVudGl0eSBmcm9tIGluYm91bmQgcmVxdWVzdCBoZWFkZXJzLgoKICAgIFByaW9yaXR5OgogICAgMS4gU1BJRkZFIElEIGZyb20geC1mb3J3YXJkZWQtY2xpZW50LWNlcnQgKEthZ2VudGkgZW52b3kgbVRMUykKICAgIDIuIEV4cGxpY2l0IHgtb3BlbmNsYXctdXNlciBoZWFkZXIgZnJvbSBjYWxsZXIKICAgIDMuIE5vbmUgKGdhdGV3YXkgd2lsbCBjcmVhdGUgYW4gZXBoZW1lcmFsIHNlc3Npb24pCiAgICAiIiIKICAgICMgS2FnZW50aSBlbnZveSBhZGRzIFhGQ0Mgd2l0aCB0aGUgcmVtb3RlIGFnZW50J3MgU1BJRkZFIElECiAgICB4ZmNjID0gaHR0cF9oZWFkZXJzLmdldCgieC1mb3J3YXJkZWQtY2xpZW50LWNlcnQiLCAiIikKICAgIGlmIHhmY2M6CiAgICAgICAgIyBYRkNDIGZvcm1hdDogVVJJPXNwaWZmZTovL2RvbWFpbi9zYS9hZ2VudC1uYW1lOy4uLgogICAgICAgIG1hdGNoID0gcmUuc2VhcmNoKHIiVVJJPXNwaWZmZTovL1teL10rL3NhLyhbXjssXHNdKykiLCB4ZmNjKQogICAgICAgIGlmIG1hdGNoOgogICAgICAgICAgICByZXR1cm4gZiJhMmE6e21hdGNoLmdyb3VwKDEpfSIKCiAgICAjIENhbGxlci1wcm92aWRlZCBpZGVudGl0eQogICAgdXNlciA9IGh0dHBfaGVhZGVycy5nZXQoIngtb3BlbmNsYXctdXNlciIsICIiKQogICAgaWYgdXNlcjoKICAgICAgICByZXR1cm4gdXNlcgoKICAgIHJldHVybiBOb25lCgoKZGVmIGNhbGxfZ2F0ZXdheShtZXNzYWdlcywgc3RyZWFtPUZhbHNlLCBzZW5kZXJfaWQ9Tm9uZSk6CiAgICAiIiJQT1NUIHRvIHRoZSBPcGVuQ2xhdyBnYXRld2F5J3MgT3BlbkFJLWNvbXBhdGlibGUgZW5kcG9pbnQuIiIiCiAgICBib2R5ID0ganNvbi5kdW1wcyh7CiAgICAgICAgIm1lc3NhZ2VzIjogbWVzc2FnZXMsCiAgICAgICAgInN0cmVhbSI6IHN0cmVhbSwKICAgIH0pLmVuY29kZSgpCiAgICBoZWFkZXJzID0gewogICAgICAgICJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24vanNvbiIsCiAgICAgICAgIkF1dGhvcml6YXRpb24iOiBmIkJlYXJlciB7R0FURVdBWV9UT0tFTn0iLAogICAgfQogICAgaWYgQUdFTlRfSUQ6CiAgICAgICAgaGVhZGVyc1sieC1vcGVuY2xhdy1hZ2VudC1pZCJdID0gQUdFTlRfSUQKICAgIGlmIHNlbmRlcl9pZDoKICAgICAgICBoZWFkZXJzWyJ4LW9wZW5jbGF3LXVzZXIiXSA9IHNlbmRlcl9pZAogICAgcmVxID0gUmVxdWVzdCgKICAgICAgICBmIntHQVRFV0FZX1VSTH0vdjEvY2hhdC9jb21wbGV0aW9ucyIsCiAgICAgICAgZGF0YT1ib2R5LAogICAgICAgIGhlYWRlcnM9aGVhZGVycywKICAgICAgICBtZXRob2Q9IlBPU1QiLAogICAgKQogICAgcmV0dXJuIHVybG9wZW4ocmVxLCB0aW1lb3V0PTMwMCkKCgpkZWYgZXh0cmFjdF90ZXh0KHBhcnRzKToKICAgICIiIkV4dHJhY3QgY29uY2F0ZW5hdGVkIHRleHQgZnJvbSBBMkEgbWVzc2FnZSBwYXJ0cy4iIiIKICAgIHRleHRzID0gW10KICAgIGZvciBwYXJ0IGluIHBhcnRzOgogICAgICAgIGlmIHBhcnQuZ2V0KCJraW5kIikgPT0gInRleHQiIGFuZCAidGV4dCIgaW4gcGFydDoKICAgICAgICAgICAgdGV4dHMuYXBwZW5kKHBhcnRbInRleHQiXSkKICAgIHJldHVybiAiXG4iLmpvaW4odGV4dHMpCgoKZGVmIGEyYV9yZXN1bHQocnBjX2lkLCB0ZXh0KToKICAgICIiIkJ1aWxkIGFuIEEyQSBKU09OLVJQQyBzdWNjZXNzIHJlc3BvbnNlIHdpdGggYSBjb21wbGV0ZWQgdGFzay4iIiIKICAgIHJldHVybiB7CiAgICAgICAgImpzb25ycGMiOiAiMi4wIiwKICAgICAgICAiaWQiOiBycGNfaWQsCiAgICAgICAgInJlc3VsdCI6IHsKICAgICAgICAgICAgImlkIjogc3RyKHV1aWQudXVpZDQoKSksCiAgICAgICAgICAgICJzdGF0dXMiOiB7CiAgICAgICAgICAgICAgICAic3RhdGUiOiAiQ09NUExFVEVEIiwKICAgICAgICAgICAgICAgICJtZXNzYWdlIjogewogICAgICAgICAgICAgICAgICAgICJyb2xlIjogImFnZW50IiwKICAgICAgICAgICAgICAgICAgICAicGFydHMiOiBbeyJraW5kIjogInRleHQiLCAidGV4dCI6IHRleHR9XSwKICAgICAgICAgICAgICAgIH0sCiAgICAgICAgICAgIH0sCiAgICAgICAgfSwKICAgIH0KCgpkZWYgYTJhX2Vycm9yKHJwY19pZCwgY29kZSwgbWVzc2FnZSk6CiAgICAiIiJCdWlsZCBhbiBBMkEgSlNPTi1SUEMgZXJyb3IgcmVzcG9uc2UuIiIiCiAgICByZXR1cm4gewogICAgICAgICJqc29ucnBjIjogIjIuMCIsCiAgICAgICAgImlkIjogcnBjX2lkLAogICAgICAgICJlcnJvciI6IHsiY29kZSI6IGNvZGUsICJtZXNzYWdlIjogbWVzc2FnZX0sCiAgICB9CgoKY2xhc3MgQTJBQnJpZGdlSGFuZGxlcihCYXNlSFRUUFJlcXVlc3RIYW5kbGVyKToKICAgIGRlZiBsb2dfbWVzc2FnZShzZWxmLCBmbXQsICphcmdzKToKICAgICAgICBwcmludChmIlthMmEtYnJpZGdlXSB7Zm10ICUgYXJnc30iKQoKICAgICMgLS0tIEdFVDogYWdlbnQgY2FyZCAtLS0KCiAgICBkZWYgZG9fR0VUKHNlbGYpOgogICAgICAgIGlmIHNlbGYucGF0aCBpbiAoIi8ud2VsbC1rbm93bi9hZ2VudC5qc29uIiwgIi8ud2VsbC1rbm93bi9hZ2VudC1jYXJkLmpzb24iKToKICAgICAgICAgICAgZmlsZW5hbWUgPSBzZWxmLnBhdGgucnNwbGl0KCIvIiwgMSlbLTFdCiAgICAgICAgICAgIGNvbnRlbnQgPSByZWFkX2FnZW50X2NhcmQoZmlsZW5hbWUpCiAgICAgICAgICAgIGlmIGNvbnRlbnQgaXMgbm90IE5vbmU6CiAgICAgICAgICAgICAgICBzZWxmLnNlbmRfcmVzcG9uc2UoMjAwKQogICAgICAgICAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1UeXBlIiwgImFwcGxpY2F0aW9uL2pzb24iKQogICAgICAgICAgICAgICAgc2VsZi5lbmRfaGVhZGVycygpCiAgICAgICAgICAgICAgICBzZWxmLndmaWxlLndyaXRlKGNvbnRlbnQuZW5jb2RlKCkpCiAgICAgICAgICAgICAgICByZXR1cm4KICAgICAgICAgICAgc2VsZi5zZW5kX2Vycm9yKDQwNCwgZiJ7ZmlsZW5hbWV9IG5vdCBmb3VuZCIpCiAgICAgICAgICAgIHJldHVybgoKICAgICAgICBpZiBzZWxmLnBhdGggPT0gIi9oZWFsdGh6IjoKICAgICAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKDIwMCkKICAgICAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1UeXBlIiwgInRleHQvcGxhaW4iKQogICAgICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkKICAgICAgICAgICAgc2VsZi53ZmlsZS53cml0ZShiIm9rIikKICAgICAgICAgICAgcmV0dXJuCgogICAgICAgIHNlbGYuc2VuZF9lcnJvcig0MDQsICJOb3QgZm91bmQiKQoKICAgICMgLS0tIFBPU1Q6IEEyQSBKU09OLVJQQyAtLS0KCiAgICBkZWYgZG9fUE9TVChzZWxmKToKICAgICAgICBjb250ZW50X2xlbmd0aCA9IGludChzZWxmLmhlYWRlcnMuZ2V0KCJDb250ZW50LUxlbmd0aCIsIDApKQogICAgICAgIHJhdyA9IHNlbGYucmZpbGUucmVhZChjb250ZW50X2xlbmd0aCkKCiAgICAgICAgdHJ5OgogICAgICAgICAgICByZXEgPSBqc29uLmxvYWRzKHJhdykKICAgICAgICBleGNlcHQganNvbi5KU09ORGVjb2RlRXJyb3I6CiAgICAgICAgICAgIHNlbGYuX3NlbmRfanNvbig0MDAsIGEyYV9lcnJvcihOb25lLCAtMzI3MDAsICJQYXJzZSBlcnJvciIpKQogICAgICAgICAgICByZXR1cm4KCiAgICAgICAgcnBjX2lkID0gcmVxLmdldCgiaWQiKQogICAgICAgIG1ldGhvZCA9IHJlcS5nZXQoIm1ldGhvZCIsICIiKQogICAgICAgIHBhcmFtcyA9IHJlcS5nZXQoInBhcmFtcyIsIHt9KQogICAgICAgIG1lc3NhZ2UgPSBwYXJhbXMuZ2V0KCJtZXNzYWdlIiwge30pCiAgICAgICAgcGFydHMgPSBtZXNzYWdlLmdldCgicGFydHMiLCBbXSkKICAgICAgICB1c2VyX3RleHQgPSBleHRyYWN0X3RleHQocGFydHMpCgogICAgICAgIGlmIG5vdCB1c2VyX3RleHQ6CiAgICAgICAgICAgIHNlbGYuX3NlbmRfanNvbigyMDAsIGEyYV9lcnJvcihycGNfaWQsIC0zMjYwMiwgIk5vIHRleHQgaW4gbWVzc2FnZSBwYXJ0cyIpKQogICAgICAgICAgICByZXR1cm4KCiAgICAgICAgIyBFeHRyYWN0IHNlbmRlciBpZGVudGl0eSBmb3Igc2Vzc2lvbiBwaW5uaW5nCiAgICAgICAgc2VuZGVyX2lkID0gZXh0cmFjdF9zZW5kZXJfaWQoc2VsZi5oZWFkZXJzKQogICAgICAgIGlmIHNlbmRlcl9pZDoKICAgICAgICAgICAgc2VsZi5sb2dfbWVzc2FnZSgiU2Vzc2lvbiBwaW5uZWQgdG8gc2VuZGVyOiAlcyIsIHNlbmRlcl9pZCkKCiAgICAgICAgbWVzc2FnZXMgPSBbeyJyb2xlIjogInVzZXIiLCAiY29udGVudCI6IHVzZXJfdGV4dH1dCgogICAgICAgIGlmIG1ldGhvZCA9PSAibWVzc2FnZS9zZW5kIjoKICAgICAgICAgICAgc2VsZi5faGFuZGxlX3NlbmQocnBjX2lkLCBtZXNzYWdlcywgc2VuZGVyX2lkKQogICAgICAgIGVsaWYgbWV0aG9kID09ICJtZXNzYWdlL3N0cmVhbSI6CiAgICAgICAgICAgIHNlbGYuX2hhbmRsZV9zdHJlYW0ocnBjX2lkLCBtZXNzYWdlcywgc2VuZGVyX2lkKQogICAgICAgIGVsc2U6CiAgICAgICAgICAgIHNlbGYuX3NlbmRfanNvbigyMDAsIGEyYV9lcnJvcihycGNfaWQsIC0zMjYwMSwgZiJVbmtub3duIG1ldGhvZDoge21ldGhvZH0iKSkKCiAgICBkZWYgX2hhbmRsZV9zZW5kKHNlbGYsIHJwY19pZCwgbWVzc2FnZXMsIHNlbmRlcl9pZD1Ob25lKToKICAgICAgICB0cnk6CiAgICAgICAgICAgIHJlc3AgPSBjYWxsX2dhdGV3YXkobWVzc2FnZXMsIHN0cmVhbT1GYWxzZSwgc2VuZGVyX2lkPXNlbmRlcl9pZCkKICAgICAgICAgICAgZGF0YSA9IGpzb24ubG9hZHMocmVzcC5yZWFkKCkpCiAgICAgICAgICAgIHRleHQgPSBkYXRhWyJjaG9pY2VzIl1bMF1bIm1lc3NhZ2UiXVsiY29udGVudCJdCiAgICAgICAgICAgIHNlbGYuX3NlbmRfanNvbigyMDAsIGEyYV9yZXN1bHQocnBjX2lkLCB0ZXh0KSkKICAgICAgICBleGNlcHQgKEhUVFBFcnJvciwgVVJMRXJyb3IpIGFzIGU6CiAgICAgICAgICAgIG1zZyA9IHN0cihlKQogICAgICAgICAgICBpZiBoYXNhdHRyKGUsICJyZWFkIik6CiAgICAgICAgICAgICAgICBtc2cgPSBlLnJlYWQoKS5kZWNvZGUoZXJyb3JzPSJyZXBsYWNlIilbOjUwMF0KICAgICAgICAgICAgc2VsZi5fc2VuZF9qc29uKDIwMCwgYTJhX2Vycm9yKHJwY19pZCwgLTMyMDAwLCBmIkdhdGV3YXkgZXJyb3I6IHttc2d9IikpCiAgICAgICAgZXhjZXB0IChLZXlFcnJvciwgSW5kZXhFcnJvcikgYXMgZToKICAgICAgICAgICAgc2VsZi5fc2VuZF9qc29uKDIwMCwgYTJhX2Vycm9yKHJwY19pZCwgLTMyMDAwLCBmIkJhZCBnYXRld2F5IHJlc3BvbnNlOiB7ZX0iKSkKCiAgICBkZWYgX2hhbmRsZV9zdHJlYW0oc2VsZiwgcnBjX2lkLCBtZXNzYWdlcywgc2VuZGVyX2lkPU5vbmUpOgogICAgICAgIHRhc2tfaWQgPSBzdHIodXVpZC51dWlkNCgpKQogICAgICAgIHRyeToKICAgICAgICAgICAgcmVzcCA9IGNhbGxfZ2F0ZXdheShtZXNzYWdlcywgc3RyZWFtPVRydWUsIHNlbmRlcl9pZD1zZW5kZXJfaWQpCiAgICAgICAgZXhjZXB0IChIVFRQRXJyb3IsIFVSTEVycm9yKSBhcyBlOgogICAgICAgICAgICBtc2cgPSBzdHIoZSkKICAgICAgICAgICAgaWYgaGFzYXR0cihlLCAicmVhZCIpOgogICAgICAgICAgICAgICAgbXNnID0gZS5yZWFkKCkuZGVjb2RlKGVycm9ycz0icmVwbGFjZSIpWzo1MDBdCiAgICAgICAgICAgIHNlbGYuX3NlbmRfanNvbigyMDAsIGEyYV9lcnJvcihycGNfaWQsIC0zMjAwMCwgZiJHYXRld2F5IGVycm9yOiB7bXNnfSIpKQogICAgICAgICAgICByZXR1cm4KCiAgICAgICAgIyBTdGFydCBTU0UgcmVzcG9uc2UKICAgICAgICBzZWxmLnNlbmRfcmVzcG9uc2UoMjAwKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtVHlwZSIsICJ0ZXh0L2V2ZW50LXN0cmVhbSIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ2FjaGUtQ29udHJvbCIsICJuby1jYWNoZSIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29ubmVjdGlvbiIsICJrZWVwLWFsaXZlIikKICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkKCiAgICAgICAgY29sbGVjdGVkX3RleHQgPSAiIgogICAgICAgIHRyeToKICAgICAgICAgICAgZm9yIGxpbmUgaW4gcmVzcDoKICAgICAgICAgICAgICAgIGxpbmUgPSBsaW5lLmRlY29kZSgidXRmLTgiLCBlcnJvcnM9InJlcGxhY2UiKS5zdHJpcCgpCiAgICAgICAgICAgICAgICBpZiBub3QgbGluZS5zdGFydHN3aXRoKCJkYXRhOiAiKToKICAgICAgICAgICAgICAgICAgICBjb250aW51ZQogICAgICAgICAgICAgICAgcGF5bG9hZCA9IGxpbmVbNjpdCiAgICAgICAgICAgICAgICBpZiBwYXlsb2FkID09ICJbRE9ORV0iOgogICAgICAgICAgICAgICAgICAgIGJyZWFrCiAgICAgICAgICAgICAgICB0cnk6CiAgICAgICAgICAgICAgICAgICAgY2h1bmsgPSBqc29uLmxvYWRzKHBheWxvYWQpCiAgICAgICAgICAgICAgICAgICAgZGVsdGEgPSBjaHVuay5nZXQoImNob2ljZXMiLCBbe31dKVswXS5nZXQoImRlbHRhIiwge30pCiAgICAgICAgICAgICAgICAgICAgY29udGVudCA9IGRlbHRhLmdldCgiY29udGVudCIsICIiKQogICAgICAgICAgICAgICAgICAgIGlmIGNvbnRlbnQ6CiAgICAgICAgICAgICAgICAgICAgICAgIGNvbGxlY3RlZF90ZXh0ICs9IGNvbnRlbnQKICAgICAgICAgICAgICAgICAgICAgICAgZXZlbnQgPSB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAianNvbnJwYyI6ICIyLjAiLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgImlkIjogcnBjX2lkLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgInJlc3VsdCI6IHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAiaWQiOiB0YXNrX2lkLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICJzdGF0dXMiOiB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICJzdGF0ZSI6ICJXT1JLSU5HIiwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIm1lc3NhZ2UiOiB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAicm9sZSI6ICJhZ2VudCIsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAicGFydHMiOiBbeyJraW5kIjogInRleHQiLCAidGV4dCI6IGNvbnRlbnR9XSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICBzZWxmLl93cml0ZV9zc2UoIm1lc3NhZ2Uvc3RyZWFtIiwgZXZlbnQpCiAgICAgICAgICAgICAgICBleGNlcHQgKGpzb24uSlNPTkRlY29kZUVycm9yLCBLZXlFcnJvciwgSW5kZXhFcnJvcik6CiAgICAgICAgICAgICAgICAgICAgY29udGludWUKCiAgICAgICAgICAgICMgU2VuZCBmaW5hbCBjb21wbGV0ZWQgZXZlbnQKICAgICAgICAgICAgZmluYWxfZXZlbnQgPSB7CiAgICAgICAgICAgICAgICAianNvbnJwYyI6ICIyLjAiLAogICAgICAgICAgICAgICAgImlkIjogcnBjX2lkLAogICAgICAgICAgICAgICAgInJlc3VsdCI6IHsKICAgICAgICAgICAgICAgICAgICAiaWQiOiB0YXNrX2lkLAogICAgICAgICAgICAgICAgICAgICJzdGF0dXMiOiB7CiAgICAgICAgICAgICAgICAgICAgICAgICJzdGF0ZSI6ICJDT01QTEVURUQiLAogICAgICAgICAgICAgICAgICAgICAgICAibWVzc2FnZSI6IHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgICJyb2xlIjogImFnZW50IiwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICJwYXJ0cyI6IFt7ImtpbmQiOiAidGV4dCIsICJ0ZXh0IjogY29sbGVjdGVkX3RleHR9XSwKICAgICAgICAgICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgICAgICAgICB9LAogICAgICAgICAgICAgICAgfSwKICAgICAgICAgICAgfQogICAgICAgICAgICBzZWxmLl93cml0ZV9zc2UoIm1lc3NhZ2Uvc3RyZWFtIiwgZmluYWxfZXZlbnQpCiAgICAgICAgZXhjZXB0IChCcm9rZW5QaXBlRXJyb3IsIENvbm5lY3Rpb25SZXNldEVycm9yKToKICAgICAgICAgICAgcGFzcwogICAgICAgIGZpbmFsbHk6CiAgICAgICAgICAgIHJlc3AuY2xvc2UoKQoKICAgIGRlZiBfd3JpdGVfc3NlKHNlbGYsIGV2ZW50X3R5cGUsIGRhdGEpOgogICAgICAgIGxpbmUgPSBmImV2ZW50OiB7ZXZlbnRfdHlwZX1cbmRhdGE6IHtqc29uLmR1bXBzKGRhdGEpfVxuXG4iCiAgICAgICAgc2VsZi53ZmlsZS53cml0ZShsaW5lLmVuY29kZSgpKQogICAgICAgIHNlbGYud2ZpbGUuZmx1c2goKQoKICAgIGRlZiBfc2VuZF9qc29uKHNlbGYsIHN0YXR1cywgb2JqKToKICAgICAgICBib2R5ID0ganNvbi5kdW1wcyhvYmopLmVuY29kZSgpCiAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKHN0YXR1cykKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LVR5cGUiLCAiYXBwbGljYXRpb24vanNvbiIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1MZW5ndGgiLCBzdHIobGVuKGJvZHkpKSkKICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkKICAgICAgICBzZWxmLndmaWxlLndyaXRlKGJvZHkpCgoKaWYgX19uYW1lX18gPT0gIl9fbWFpbl9fIjoKICAgIHNlcnZlciA9IEhUVFBTZXJ2ZXIoKCIwLjAuMC4wIiwgTElTVEVOX1BPUlQpLCBBMkFCcmlkZ2VIYW5kbGVyKQogICAgcHJpbnQoZiJbYTJhLWJyaWRnZV0gTGlzdGVuaW5nIG9uIDp7TElTVEVOX1BPUlR9IikKICAgIHByaW50KGYiW2EyYS1icmlkZ2VdIEdhdGV3YXk6IHtHQVRFV0FZX1VSTH0iKQogICAgcHJpbnQoZiJbYTJhLWJyaWRnZV0gQWdlbnQ6IHtBR0VOVF9JRCBvciAnKGRlZmF1bHQpJ30iKQogICAgcHJpbnQoZiJbYTJhLWJyaWRnZV0gQWdlbnQgY2FyZHM6IHtBR0VOVF9DQVJEX0RJUn0iKQogICAgdHJ5OgogICAgICAgIHNlcnZlci5zZXJ2ZV9mb3JldmVyKCkKICAgIGV4Y2VwdCBLZXlib2FyZEludGVycnVwdDoKICAgICAgICBwYXNzCiAgICBzZXJ2ZXIuc2VydmVyX2Nsb3NlKCkK";
const A2A_SKILL_MD = readFileSync(new URL("./assets/a2a-skill.md", import.meta.url), "utf8");

const ENVOY_CONFIG = `admin:
  address:
    socket_address: { protocol: TCP, address: 127.0.0.1, port_value: 9901 }

static_resources:
  listeners:
  - name: outbound_listener
    address:
      socket_address: { protocol: TCP, address: 0.0.0.0, port_value: 15123 }
    listener_filters:
    - name: envoy.filters.listener.original_dst
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.filters.listener.original_dst.v3.OriginalDst
    - name: envoy.filters.listener.tls_inspector
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector
    filter_chains:
    - filter_chain_match: { transport_protocol: tls }
      filters:
      - name: envoy.filters.network.tcp_proxy
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.tcp_proxy.v3.TcpProxy
          stat_prefix: outbound_tls_passthrough
          cluster: original_destination
    - filter_chain_match: { transport_protocol: raw_buffer }
      filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: outbound_http
          codec_type: AUTO
          route_config:
            name: outbound_routes
            virtual_hosts:
            - name: catch_all
              domains: ["*"]
              routes:
              - match: { prefix: "/" }
                route: { cluster: original_destination }
          http_filters:
          - name: envoy.filters.http.ext_proc
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.ext_proc.v3.ExternalProcessor
              grpc_service:
                envoy_grpc: { cluster_name: ext_proc_cluster }
                timeout: 30s
              processing_mode:
                request_header_mode: SEND
                response_header_mode: SKIP
                request_body_mode: NONE
                response_body_mode: NONE
          - name: envoy.filters.http.router
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
  - name: inbound_listener
    address:
      socket_address: { protocol: TCP, address: 0.0.0.0, port_value: 15124 }
    listener_filters:
    - name: envoy.filters.listener.original_dst
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.filters.listener.original_dst.v3.OriginalDst
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          stat_prefix: inbound_http
          codec_type: AUTO
          route_config:
            name: inbound_routes
            virtual_hosts:
            - name: local_app
              domains: ["*"]
              request_headers_to_add:
              - header: { key: "x-authbridge-direction", value: "inbound" }
                append: false
              routes:
              - match: { prefix: "/" }
                route: { cluster: original_destination }
          http_filters:
          - name: envoy.filters.http.ext_proc
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.ext_proc.v3.ExternalProcessor
              grpc_service:
                envoy_grpc: { cluster_name: ext_proc_cluster }
                timeout: 30s
              processing_mode:
                request_header_mode: SEND
                response_header_mode: SKIP
                request_body_mode: NONE
                response_body_mode: NONE
          - name: envoy.filters.http.router
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
  clusters:
  - name: original_destination
    connect_timeout: 30s
    type: ORIGINAL_DST
    lb_policy: CLUSTER_PROVIDED
    original_dst_lb_config: { use_http_header: false }
  - name: ext_proc_cluster
    connect_timeout: 5s
    type: STATIC
    lb_policy: ROUND_ROBIN
    http2_protocol_options: {}
    load_assignment:
      cluster_name: ext_proc_cluster
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address: { address: 127.0.0.1, port_value: 9090 }
`;

const SPIFFE_HELPER_CONFIG = `agent_address = "/spiffe-workload-api/spire-agent.sock"
cmd = ""
cmd_args = ""
svid_file_name = "/opt/svid.pem"
svid_key_file_name = "/opt/svid_key.pem"
svid_bundle_file_name = "/opt/svid_bundle.pem"
jwt_svids = [{jwt_audience="kagenti", jwt_svid_file_name="/opt/jwt_svid.token"}]
jwt_svid_file_mode = 0644
include_federated_domains = true
`;

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

export function a2aRealm(config: DeployConfig): string {
  return config.a2aRealm?.trim() || process.env.KEYCLOAK_REALM || DEFAULT_A2A_REALM;
}

export function a2aKeycloakNamespace(config: DeployConfig): string {
  return config.a2aKeycloakNamespace?.trim() || process.env.KEYCLOAK_NAMESPACE || DEFAULT_A2A_KEYCLOAK_NAMESPACE;
}

export function builtInA2aSkillEntries(entries: TreeEntry[]): TreeEntry[] {
  if (entries.some((entry) => entry.path === "a2a/SKILL.md")) {
    return entries;
  }
  return [
    ...entries,
    {
      key: "builtin-a2a-skill",
      path: "a2a/SKILL.md",
      content: A2A_SKILL_MD,
    },
  ];
}

export function a2aServiceAccountManifest(ns: string): k8s.V1ServiceAccount {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: "openclaw-oauth-proxy",
      namespace: ns,
      labels: { app: "openclaw" },
    },
  };
}

export function a2aNamespacePatch(ns: string): k8s.V1Namespace {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: ns,
      labels: {
        "app.kubernetes.io/managed-by": "openclaw-installer",
        "kagenti-enabled": "true",
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/enforce-version": "latest",
      },
    },
  };
}

export function environmentsConfigMapManifest(
  ns: string,
  realm: string,
  keycloakNamespace: string,
  adminUsername: string,
  adminPassword: string,
): k8s.V1ConfigMap {
  const keycloakUrl = `http://keycloak-service.${keycloakNamespace}.svc.cluster.local:8080`;
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "environments", namespace: ns, labels: { app: "openclaw" } },
    data: {
      KEYCLOAK_REALM: realm,
      KEYCLOAK_URL: keycloakUrl,
      KEYCLOAK_ADMIN_USERNAME: adminUsername,
      KEYCLOAK_ADMIN_PASSWORD: adminPassword,
      KEYCLOAK_TOKEN_EXCHANGE_ENABLED: "true",
      KEYCLOAK_CLIENT_REGISTRATION_ENABLED: "true",
      SPIRE_ENABLED: "true",
    },
  };
}

export function authbridgeConfigMapManifest(
  ns: string,
  realm: string,
  issuerBaseUrl: string,
  keycloakNamespace: string,
): k8s.V1ConfigMap {
  const keycloakUrl = `http://keycloak-service.${keycloakNamespace}.svc.cluster.local:8080`;
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "authbridge-config", namespace: ns, labels: { app: "openclaw" } },
    data: {
      TOKEN_URL: `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`,
      ISSUER: `${issuerBaseUrl}/realms/${realm}`,
      TARGET_AUDIENCE: "auth-target",
      TARGET_SCOPES: "openid auth-target-aud",
    },
  };
}

export function envoyConfigMapManifest(ns: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "envoy-config", namespace: ns, labels: { app: "openclaw" } },
    data: { "envoy.yaml": ENVOY_CONFIG },
  };
}

export function spiffeHelperConfigMapManifest(ns: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: "spiffe-helper-config", namespace: ns, labels: { app: "openclaw" } },
    data: { "helper.conf": SPIFFE_HELPER_CONFIG },
  };
}

export function a2aBridgeConfigMapManifest(ns: string): k8s.V1ConfigMap {
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "a2a-bridge",
      namespace: ns,
      labels: { app: "openclaw", "app.kubernetes.io/component": "a2a-bridge" },
    },
    data: { "a2a-bridge.py": decodeBase64(A2A_BRIDGE_PY_BASE64) },
  };
}

export function agentCardDataConfigMapManifest(ns: string): k8s.V1ConfigMap {
  const agentCard = {
    name: "openclaw",
    description: "OpenClaw AI Agent Gateway",
    version: "1.0.0",
    url: "http://openclaw:18789",
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
  };

  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: "openclaw-agent-card",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    data: {
      "agent.json": JSON.stringify(agentCard, null, 2),
      "agent-card.json": JSON.stringify(agentCard, null, 2),
    },
  };
}

export function agentCardManifest(ns: string): Record<string, unknown> {
  return {
    apiVersion: "agent.kagenti.dev/v1alpha1",
    kind: "AgentCard",
    metadata: {
      name: "openclaw-agent-card",
      namespace: ns,
      labels: {
        "app.kubernetes.io/name": "openclaw",
        "kagenti.io/protocol": "a2a",
        "kagenti.io/framework": "OpenClaw",
      },
    },
    spec: {
      selector: {
        matchLabels: {
          app: "openclaw",
        },
      },
      syncPeriod: "30s",
    },
  };
}
