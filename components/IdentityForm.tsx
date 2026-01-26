"use client";

import { useState, FormEvent, useRef, ChangeEvent, useEffect } from "react";
import { ModelPackIdentity, FaceImageMetadata, StructuredNotes, IdentityProfile } from "@/lib/types/firestore";
import { leagues, LeagueKey } from "@/lib/data/leagues";
import { storage } from "@/lib/firebase/config";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { useAuth } from "@/lib/providers/AuthProvider";
import ChipSelect from "./ChipSelect";
import ReadinessBanner from "./ReadinessBanner";
import { Timestamp } from "firebase/firestore";

interface IdentityFormProps {
  identity?: ModelPackIdentity;
  packId: string;
  onSubmit: (identity: Omit<ModelPackIdentity, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

// Helper to validate token format
function validateToken(token: string): string | null {
  if (!token.startsWith("rp_")) {
    return "Token must start with 'rp_'";
  }
  if (token.length < 4 || token.length > 32) {
    return "Token must be between 4 and 32 characters";
  }
  if (!/^rp_[a-z0-9_]+$/.test(token)) {
    return "Token can only contain lowercase letters, numbers, and underscores";
  }
  return null;
}

export default function IdentityForm({ identity, packId, onSubmit, onCancel, loading }: IdentityFormProps) {
  const { user } = useAuth();
  const [name, setName] = useState(identity?.name || "");
  const [token, setToken] = useState(identity?.token || "");
  const [bodyType, setBodyType] = useState<ModelPackIdentity["bodyType"]>(
    Array.isArray(identity?.bodyType)
      ? identity!.bodyType
      : identity?.bodyType
      ? [identity.bodyType as any]
      : ["athletic"]
  );
  const [ageRange, setAgeRange] = useState(identity?.ageRange || "21-29");
  const [ethnicity, setEthnicity] = useState(identity?.ethnicity || "");
  const [styleVibe, setStyleVibe] = useState(identity?.styleVibe || "");
  
  // Structured notes
  const [structuredNotes, setStructuredNotes] = useState<StructuredNotes>(identity?.structuredNotes || {
    voiceQuirks: "",
    doDont: "",
    visualMotifs: "",
    locations: "",
    raw: identity?.notes || "",
  });
  
  // Persona fields
  const [hometown, setHometown] = useState(identity?.hometown || "");
  const [region, setRegion] = useState(identity?.region || "");
  const [neighborhood, setNeighborhood] = useState(identity?.neighborhood || "");
  const [almaMater, setAlmaMater] = useState(identity?.almaMater || identity?.college || "");
  
  // Primary teams: one per league (enforced)
  type PrimaryTeamByLeague = { league: LeagueKey; team: string };
  const [primaryTeamsByLeague, setPrimaryTeamsByLeague] = useState<PrimaryTeamByLeague[]>(() => {
    if (identity?.primaryTeams) {
      const grouped: PrimaryTeamByLeague[] = [];
      identity.primaryTeams.forEach((t) => {
        const [lg, tm] = t.split(" – ");
        if (lg && tm && !grouped.find(p => p.league === lg)) {
          grouped.push({ league: lg as LeagueKey, team: tm });
        }
      });
      return grouped;
    }
    return [];
  });
  
  const [secondaryTeams, setSecondaryTeams] = useState<string[]>(identity?.secondaryTeams || []);
  const [fandomIntensity, setFandomIntensity] = useState<"die-hard" | "strong" | "casual" | undefined>(identity?.fandomIntensity);
  const [personaBio, setPersonaBio] = useState(identity?.personaBio || "");
  
  // Identity profile fields
  const [identityProfile, setIdentityProfile] = useState<IdentityProfile>(identity?.identityProfile || {
    promptSignature: "",
    negativeSignature: "",
    visualMotifs: [],
    locations: [],
  });
  
  // Instagram fields
  const [instagramHandle, setInstagramHandle] = useState(identity?.instagram?.handle || "");
  const [instagramStatus, setInstagramStatus] = useState<"draft" | "active" | "planned" | "paused" | undefined>(identity?.instagram?.accountStatus);
  const [contentTone, setContentTone] = useState(identity?.instagram?.contentTone || "");
  const [postingStyle, setPostingStyle] = useState(identity?.instagram?.postingStyle || "");
  
  // Face images with metadata
  const [faceImages, setFaceImages] = useState<FaceImageMetadata[]>(() => {
    if (identity?.faceImages) {
      return identity.faceImages;
    }
    // Migrate from legacy faceImagePaths
    if (identity?.faceImagePaths) {
      return identity.faceImagePaths.map(url => ({ url, approved: false }));
    }
    return [];
  });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // Secondary teams (can have multiple per league)
  type SecondaryTeamByLeague = { league: LeagueKey; teams: string[] };
  const [secondaryTeamsByLeague, setSecondaryTeamsByLeague] = useState<SecondaryTeamByLeague[]>(() => {
    if (identity?.secondaryTeams) {
      const grouped: Record<string, string[]> = {};
      identity.secondaryTeams.forEach((t) => {
        const [lg, tm] = t.split(" – ");
        if (lg && tm) {
          if (!grouped[lg]) grouped[lg] = [];
          grouped[lg].push(tm);
        }
      });
      return Object.entries(grouped).map(([lg, teams]) => ({
        league: lg as LeagueKey,
        teams,
      }));
    }
    return [];
  });

  const generateTokenFromName = (value: string) => {
    const base = value.toLowerCase().trim();
    const slug = base
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .substring(0, 28);
    return slug ? `rp_${slug}` : "rp_";
  };

  // Auto-generate token and Instagram handle from name
  useEffect(() => {
    if (!identity) {
      setToken(generateTokenFromName(name));
    }
  }, [name, identity]);

  // Auto-generate Instagram handle from name
  useEffect(() => {
    if (name && !identity?.instagram?.handle) {
      const handle = name.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
      setInstagramHandle(`@${handle}.rally`);
    }
  }, [name, identity]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Name is required";
    if (!identity && !token.trim()) {
      newErrors.token = "Token is required";
    } else if (token && !identity) {
      const tokenError = validateToken(token);
      if (tokenError) newErrors.token = tokenError;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFileUpload = async (files: FileList) => {
    if (!storage || !packId || !identity?.id) {
      alert("Cannot upload: missing pack or identity ID");
      return;
    }

    setUploading(true);
    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const fileId = crypto.randomUUID();
        const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
        if (!storage) throw new Error("Storage not initialized");
        const storageRef = ref(
          storage,
          `modelpacks/${packId}/identities/${identity.id}/faces/${fileId}.${fileExt}`
        );
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        // Create metadata object without any undefined fields (Firestore does not accept undefined)
        const metadata: FaceImageMetadata = {
          url,
          source: "uploaded",
          containsLogos: false,
          approved: false,
          rightsAttested: false,
          uploadedAt: Timestamp.now(),
        };
        return metadata;
      });

      const newImages = await Promise.all(uploadPromises);
      setFaceImages([...faceImages, ...newImages]);
    } catch (error: any) {
      setErrors({ upload: error.message || "Failed to upload images" });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (index: number) => {
    if (!storage || !identity?.id) return;
    
    const image = faceImages[index];
    try {
      // Extract path from URL and delete from storage
      const urlObj = new URL(image.url);
      const path = decodeURIComponent(urlObj.pathname.split('/o/')[1]?.split('?')[0] || '');
      if (path) {
        const storageRef = ref(storage, path);
        await deleteObject(storageRef);
      }
      setFaceImages(faceImages.filter((_, i) => i !== index));
    } catch (error: any) {
      console.error("Failed to delete image:", error);
    }
  };

  const handleUpdateImageMetadata = (index: number, updates: Partial<FaceImageMetadata>) => {
    const newImages = [...faceImages];
    newImages[index] = { ...newImages[index], ...updates };
    setFaceImages(newImages);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      // Format primary teams: one per league
      const formattedPrimaryTeams = primaryTeamsByLeague
        .filter((p) => p.league && p.team)
        .map((p) => `${p.league} – ${p.team}`);
      
      const formattedSecondaryTeams = secondaryTeamsByLeague
        .filter((t) => t.league && t.teams.length)
        .flatMap((t) => t.teams.map((team) => `${t.league} – ${team}`));

      // Calculate training readiness
      const approvedCount = faceImages.filter((img) => img.approved !== false).length;
      const hasLogos = faceImages.some((img) => img.containsLogos === true);
      const closeCount = faceImages.filter(
        (img) => img.type === "close" && img.approved !== false
      ).length;
      const midCount = faceImages.filter(
        (img) => img.type === "mid" && img.approved !== false
      ).length;
      const fullCount = faceImages.filter(
        (img) => img.type === "full" && img.approved !== false
      ).length;
      const anchorCount = faceImages.filter(
        (img) => img.type === "anchor" && img.approved !== false
      ).length;
      const mixSatisfied = closeCount >= 6 && midCount >= 6 && fullCount >= 6 && anchorCount >= 2;
      const canTrain: boolean = approvedCount >= 20 && mixSatisfied && !hasLogos && !!name && !!token;

      // Clean face image metadata to strip undefined values before sending to Firestore
      const cleanedFaceImages: FaceImageMetadata[] = faceImages.map((img) => {
        const cleaned: any = { url: img.url };
        if (img.type) cleaned.type = img.type;
        if (img.source) cleaned.source = img.source;
        if (typeof img.qualityScore === "number") cleaned.qualityScore = img.qualityScore;
        if (img.containsLogos !== undefined) cleaned.containsLogos = img.containsLogos;
        if (img.approved !== undefined) cleaned.approved = img.approved;
        if (img.rejected !== undefined) cleaned.rejected = img.rejected;
        if (img.rejectionReason) cleaned.rejectionReason = img.rejectionReason;
        if (img.rightsAttested !== undefined) cleaned.rightsAttested = img.rightsAttested;
        if (img.rightsAttestedAt) cleaned.rightsAttestedAt = img.rightsAttestedAt;
        if (img.uploadedAt) cleaned.uploadedAt = img.uploadedAt;
        return cleaned as FaceImageMetadata;
      });

      const identityPayload: Omit<ModelPackIdentity, "id" | "createdAt" | "updatedAt"> = {
        packId,
        name: name.trim(),
        token: identity ? identity.token : token.trim(), // Token immutable on edit
        bodyType,
        ageRange: ageRange.trim(),
        ethnicity: ethnicity?.trim() || undefined,
        styleVibe: styleVibe?.trim() || undefined,
        hometown: hometown?.trim() || undefined,
        region: region?.trim() || undefined,
        neighborhood: neighborhood?.trim() || undefined,
        almaMater: almaMater?.trim() || undefined,
        primaryTeams: formattedPrimaryTeams,
        secondaryTeams: formattedSecondaryTeams,
        fandomIntensity: fandomIntensity || undefined,
        personaBio: personaBio?.trim() || undefined,
        structuredNotes: structuredNotes,
        notes: structuredNotes.raw || undefined, // Legacy field
        identityProfile: identityProfile,
        instagram: instagramHandle || instagramStatus ? {
          handle: instagramHandle?.trim() || undefined,
          accountStatus: instagramStatus || "planned",
          contentTone: contentTone?.trim() || undefined,
          postingStyle: postingStyle?.trim() || undefined,
        } : undefined,
        status: identity?.status || "draft",
        faceImages: cleanedFaceImages,
        faceImagePaths: cleanedFaceImages.map((img) => img.url), // Legacy field
        faceImageCount: cleanedFaceImages.length,
        faceImagesApproved: approvedCount,
        canTrain: canTrain || false,
      };

      await onSubmit(identityPayload);
    } catch (error: any) {
      setErrors({ submit: error.message || "Failed to save identity" });
    }
  };

  const facesTarget = 20;
  const currentIdentity = {
    ...identity,
    name,
    token,
    faceImages,
    faceImageCount: faceImages.length,
  } as Partial<ModelPackIdentity>;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {errors.submit && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {errors.submit}
        </div>
      )}

      {/* Readiness Banner */}
      {identity && <ReadinessBanner identity={currentIdentity} />}

      {/* A) Core Identity */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">Core Identity</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400"
              placeholder="e.g., Amber"
            />
            {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-1">
              Token {!identity && "*"}
            </label>
            <input
              type="text"
              id="token"
              value={token}
              readOnly
              disabled
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                "bg-gray-50 text-gray-700 cursor-not-allowed"
              }`}
              placeholder="rp_amber"
            />
            <p className="mt-1 text-xs text-gray-500">
              Token is auto-generated from name (rp_name). Immutable after creation.
            </p>
            {errors.token && <p className="mt-1 text-sm text-red-600">{errors.token}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="bodyType" className="block text-sm font-medium text-gray-700 mb-1">
                Body Type
              </label>
              <ChipSelect
                options={["petite", "athletic", "curvy", "plus", "tall", "slim", "fit", "average", "other"]}
                selected={bodyType}
                onChange={(selected) => setBodyType(selected.length ? selected as ModelPackIdentity["bodyType"] : ["athletic"])}
                placeholder="Search and select body types..."
              />
            </div>

            <div>
              <label htmlFor="ageRange" className="block text-sm font-medium text-gray-700 mb-1">
                Age Range
              </label>
              <input
                type="text"
                id="ageRange"
                value={ageRange}
                onChange={(e) => setAgeRange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 26-32"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ethnicity" className="block text-sm font-medium text-gray-700 mb-1">
              Ethnicity
            </label>
            <select
              id="ethnicity"
              value={ethnicity}
              onChange={(e) => setEthnicity(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select...</option>
              <option value="White">White</option>
              <option value="Black or African American">Black or African American</option>
              <option value="Hispanic or Latino">Hispanic or Latino</option>
              <option value="Asian">Asian</option>
              <option value="Native American or Alaska Native">Native American or Alaska Native</option>
              <option value="Pacific Islander">Pacific Islander</option>
              <option value="Middle Eastern or North African">Middle Eastern or North African</option>
              <option value="Mixed / Multiracial">Mixed / Multiracial</option>
              <option value="Other">Other / Freeform detail</option>
            </select>
            {ethnicity === "Other" && (
              <input
                type="text"
                value={ethnicity}
                onChange={(e) => setEthnicity(e.target.value)}
                placeholder="Specify ethnicity..."
                className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            )}
          </div>

          <div>
            <label htmlFor="styleVibe" className="block text-sm font-medium text-gray-700 mb-1">
              Style Vibe
            </label>
            <input
              type="text"
              id="styleVibe"
              value={styleVibe}
              onChange={(e) => setStyleVibe(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., sporty / confident"
            />
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900">Structured Notes</h4>
            <div>
              <label htmlFor="voiceQuirks" className="block text-sm font-medium text-gray-700 mb-1">
                Voice / Quirks
              </label>
              <textarea
                id="voiceQuirks"
                value={structuredNotes.voiceQuirks || ""}
                onChange={(e) => setStructuredNotes({ ...structuredNotes, voiceQuirks: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Personality traits, speaking style, quirks..."
              />
            </div>
            <div>
              <label htmlFor="doDont" className="block text-sm font-medium text-gray-700 mb-1">
                Do / Don’t
              </label>
              <textarea
                id="doDont"
                value={structuredNotes.doDont || ""}
                onChange={(e) => setStructuredNotes({ ...structuredNotes, doDont: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="What this identity should or should not do..."
              />
            </div>
            <div>
              <label htmlFor="visualMotifs" className="block text-sm font-medium text-gray-700 mb-1">
                Visual Motifs
              </label>
              <textarea
                id="visualMotifs"
                value={structuredNotes.visualMotifs || ""}
                onChange={(e) => setStructuredNotes({ ...structuredNotes, visualMotifs: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Recurring visual elements (karaoke mic, houseplants, vintage tees...)"
              />
            </div>
            <div>
              <label htmlFor="locations" className="block text-sm font-medium text-gray-700 mb-1">
                Locations
              </label>
              <textarea
                id="locations"
                value={structuredNotes.locations || ""}
                onChange={(e) => setStructuredNotes({ ...structuredNotes, locations: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Key locations (Marina, Tahoe, Ocean Beach...)"
              />
            </div>
          </div>
        </div>
      </div>

      {/* B) Persona & Fandom */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">Persona & Fandom</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="hometown" className="block text-sm font-medium text-gray-700 mb-1">
                Hometown
              </label>
              <input
                type="text"
                id="hometown"
                value={hometown}
                onChange={(e) => setHometown(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., San Jose, CA"
              />
            </div>

            <div>
              <label htmlFor="region" className="block text-sm font-medium text-gray-700 mb-1">
                Region
              </label>
              <input
                type="text"
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Bay Area"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="neighborhood" className="block text-sm font-medium text-gray-700 mb-1">
                Neighborhood
              </label>
              <input
                type="text"
                id="neighborhood"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400"
                placeholder="e.g., Marina District, San Francisco"
              />
            </div>

            <div>
              <label htmlFor="almaMater" className="block text-sm font-medium text-gray-700 mb-1">
                Alma Mater
              </label>
              <input
                type="text"
                id="almaMater"
                value={almaMater}
                onChange={(e) => setAlmaMater(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400"
                placeholder="e.g., University of Southern California (USC)"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Primary Teams (one per league)
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Select one primary team per league. For Amber: NFL (49ers), MLB (Giants), NCAA (USC).
            </p>
            {leagues.filter(l => l.key !== "Other").map((league) => {
              const existing = primaryTeamsByLeague.find(p => p.league === league.key);
              return (
                <div key={league.key} className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">{league.label}</label>
                  <ChipSelect
                    options={league.teams}
                    selected={existing ? [existing.team] : []}
                    onChange={(selected) => {
                      const newTeams = primaryTeamsByLeague.filter(p => p.league !== league.key);
                      if (selected.length > 0) {
                        newTeams.push({ league: league.key, team: selected[0] });
                      }
                      setPrimaryTeamsByLeague(newTeams);
                    }}
                    placeholder={`Select ${league.label} team...`}
                    maxSelections={1}
                  />
                </div>
              );
            })}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Secondary Teams</label>
            <p className="text-xs text-gray-500 mb-3">
              Additional teams beyond the primary team per league.
            </p>
            {leagues.filter(l => l.key !== "Other").map((league) => {
              const existing = secondaryTeamsByLeague.find(s => s.league === league.key);
              const selectedTeams = existing ? existing.teams : [];
              return (
                <div key={league.key} className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">{league.label}</label>
                  <ChipSelect
                    options={league.teams.filter(t => {
                      // Don't show primary team in secondary list
                      const primary = primaryTeamsByLeague.find(p => p.league === league.key);
                      return !primary || primary.team !== t;
                    })}
                    selected={selectedTeams}
                    onChange={(selected) => {
                      const newTeams = secondaryTeamsByLeague.filter(s => s.league !== league.key);
                      if (selected.length > 0) {
                        newTeams.push({ league: league.key, teams: selected });
                      }
                      setSecondaryTeamsByLeague(newTeams);
                    }}
                    placeholder={`Select ${league.label} teams...`}
                  />
                </div>
              );
            })}
          </div>

          <div>
            <label htmlFor="fandomIntensity" className="block text-sm font-medium text-gray-700 mb-1">
              Fandom Intensity
            </label>
            <select
              id="fandomIntensity"
              value={fandomIntensity || ""}
              onChange={(e) => setFandomIntensity(e.target.value as typeof fandomIntensity || undefined)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select...</option>
              <option value="casual">Casual</option>
              <option value="strong">Strong</option>
              <option value="die-hard">Die-Hard</option>
            </select>
          </div>

          <div>
            <label htmlFor="personaBio" className="block text-sm font-medium text-gray-700 mb-1">
              Persona Bio (140–240 chars suggested)
            </label>
            <textarea
              id="personaBio"
              value={personaBio}
              onChange={(e) => setPersonaBio(e.target.value)}
              rows={4}
              maxLength={240}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">{personaBio.length}/240 characters</p>
          </div>
        </div>
      </div>

      {/* Identity Profile */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">Identity Profile (for Prompts)</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="promptSignature" className="block text-sm font-medium text-gray-700 mb-1">
              Prompt Signature
            </label>
            <input
              type="text"
              id="promptSignature"
              value={identityProfile.promptSignature || ""}
              onChange={(e) => setIdentityProfile({ ...identityProfile, promptSignature: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Short stable descriptor for prompts"
            />
          </div>
          <div>
            <label htmlFor="negativeSignature" className="block text-sm font-medium text-gray-700 mb-1">
              Negative Signature
            </label>
            <input
              type="text"
              id="negativeSignature"
              value={identityProfile.negativeSignature || ""}
              onChange={(e) => setIdentityProfile({ ...identityProfile, negativeSignature: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Stable negatives to avoid"
            />
          </div>
          <div>
            <label htmlFor="visualMotifs" className="block text-sm font-medium text-gray-700 mb-1">
              Visual Motifs
            </label>
            <ChipSelect
              options={["karaoke mic", "houseplants", "vintage tees", "sneakers", "baseball cap", "denim jacket", "gold jewelry", "tattoos"]}
              selected={identityProfile.visualMotifs || []}
              onChange={(selected) => setIdentityProfile({ ...identityProfile, visualMotifs: selected })}
              placeholder="Add visual motifs..."
            />
          </div>
          <div>
            <label htmlFor="locations" className="block text-sm font-medium text-gray-700 mb-1">
              Locations
            </label>
            <ChipSelect
              options={["Marina", "Tahoe", "Ocean Beach", "Mission District", "Golden Gate Park", "Chinatown", "Fisherman's Wharf"]}
              selected={identityProfile.locations || []}
              onChange={(selected) => setIdentityProfile({ ...identityProfile, locations: selected })}
              placeholder="Add locations..."
            />
          </div>
        </div>
      </div>

      {/* C) Social Presence */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">Social Presence (Metadata)</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="instagramHandle" className="block text-sm font-medium text-gray-700 mb-1">
              Instagram Handle
            </label>
            <input
              type="text"
              id="instagramHandle"
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="@amber.rally"
            />
          </div>

          <div>
            <label htmlFor="instagramStatus" className="block text-sm font-medium text-gray-700 mb-1">
              Account Status
            </label>
            <select
              id="instagramStatus"
              value={instagramStatus || ""}
              onChange={(e) => setInstagramStatus(e.target.value as typeof instagramStatus || undefined)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select...</option>
              <option value="planned">Planned</option>
              <option value="created">Created</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>

          <div>
            <label htmlFor="contentTone" className="block text-sm font-medium text-gray-700 mb-1">
              Content Tone
            </label>
            <select
              id="contentTone"
              value={contentTone}
              onChange={(e) => setContentTone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Select tone</option>
              <option value="playful">Playful</option>
              <option value="confident">Confident</option>
              <option value="loyal fan energy">Loyal fan energy</option>
              <option value="game day energy">Game day energy</option>
              <option value="friendly">Friendly</option>
              <option value="candid">Candid</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="postingStyle" className="block text-sm font-medium text-gray-700 mb-1">
              Posting Style
            </label>
            <select
              id="postingStyle"
              value={postingStyle}
              onChange={(e) => setPostingStyle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Select style</option>
              <option value="reels + carousels">Reels + carousels</option>
              <option value="reels + posts">Reels + posts</option>
              <option value="carousels + posts">Carousels + posts</option>
              <option value="stories heavy">Stories heavy</option>
              <option value="balanced mix">Balanced mix</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* D) Face Assets */}
      {identity && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-900">Face Assets</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Face Images: {faceImages.length} / {facesTarget}
                </p>
                <p className={`text-xs mt-1 ${
                  faceImages.length < 8 ? "text-red-600" :
                  faceImages.length < facesTarget ? "text-yellow-600" :
                  "text-green-600"
                }`}>
                  {faceImages.length < 8 ? "Too few faces for training stability" :
                   faceImages.length < facesTarget ? "Good start — aim for 20" :
                   "Ready for training"}
                </p>
              </div>
            </div>

            <div
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                className="hidden"
              />
              <p className="text-gray-600">
                {uploading ? "Uploading..." : "Click to upload face images (JPG, PNG, WebP)"}
              </p>
            </div>

            {faceImages.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-4">
                  {faceImages.map((image, idx) => (
                    <div key={idx} className="relative group border-2 rounded-lg p-2" style={{ borderColor: image.approved === false ? "#ef4444" : image.approved ? "#10b981" : "#e5e7eb" }}>
                      <img
                        src={image.url}
                        alt={`Face ${idx + 1}`}
                        className="w-full h-32 object-cover rounded-lg"
                      />
                      <div className="absolute top-2 right-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteImage(idx)}
                          className="bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>
                      <div className="mt-2 space-y-1">
                        <select
                          value={image.type || ""}
                          onChange={(e) => handleUpdateImageMetadata(idx, { type: e.target.value as any || undefined })}
                          className="w-full text-xs px-2 py-1 border border-gray-300 rounded"
                        >
                          <option value="">Type...</option>
                          <option value="close">Close</option>
                          <option value="mid">Mid</option>
                          <option value="full">Full</option>
                          <option value="anchor">Anchor</option>
                        </select>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleUpdateImageMetadata(idx, { approved: image.approved === true ? false : true })}
                            className={`flex-1 text-xs px-2 py-1 rounded ${image.approved === true ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateImageMetadata(idx, { containsLogos: !image.containsLogos })}
                            className={`flex-1 text-xs px-2 py-1 rounded ${image.containsLogos ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-600"}`}
                          >
                            🚫
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-blue-900 mb-2">Required Mix:</p>
                  <ul className="text-xs text-blue-800 space-y-1">
                    <li>Close: {faceImages.filter(img => img.type === "close" && img.approved !== false).length}/6</li>
                    <li>Mid: {faceImages.filter(img => img.type === "mid" && img.approved !== false).length}/6</li>
                    <li>Full: {faceImages.filter(img => img.type === "full" && img.approved !== false).length}/6</li>
                    <li>Anchor: {faceImages.filter(img => img.type === "anchor" && img.approved !== false).length}/2</li>
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="rightsAttestation"
                    checked={faceImages.every(img => img.rightsAttested)}
                    onChange={(e) => {
                      const newImages = faceImages.map(img => ({ ...img, rightsAttested: e.target.checked, rightsAttestedAt: e.target.checked ? Timestamp.now() : undefined }));
                      setFaceImages(newImages);
                    }}
                    className="w-4 h-4"
                  />
                  <label htmlFor="rightsAttestation" className="text-sm text-gray-700">
                    I have rights to use these images for training
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-4 border-t">
        <button
          type="submit"
          disabled={loading || uploading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : identity ? "Update Identity" : "Create Identity"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading || uploading}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

