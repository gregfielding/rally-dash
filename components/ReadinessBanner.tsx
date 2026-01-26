"use client";

import { useState } from "react";
import { ModelPackIdentity } from "@/lib/types/firestore";

interface ReadinessBannerProps {
  identity: Partial<ModelPackIdentity>;
}

export default function ReadinessBanner({ identity }: ReadinessBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const faceImages = identity.faceImages || [];
  const approvedCount = faceImages.filter(img => img.approved !== false).length;
  const target = 20;
  
  const hasLogos = faceImages.some(img => img.containsLogos === true);
  const hasEnoughFaces = approvedCount >= target;
  
  // Check mix requirements (6 close, 6 mid, 6 full, 2 anchor)
  const closeCount = faceImages.filter(img => img.type === "close" && img.approved !== false).length;
  const midCount = faceImages.filter(img => img.type === "mid" && img.approved !== false).length;
  const fullCount = faceImages.filter(img => img.type === "full" && img.approved !== false).length;
  const anchorCount = faceImages.filter(img => img.type === "anchor" && img.approved !== false).length;
  
  const mixSatisfied = closeCount >= 6 && midCount >= 6 && fullCount >= 6 && anchorCount >= 2;
  
  const canTrain = hasEnoughFaces && mixSatisfied && !hasLogos && identity.name && identity.token;
  
  const checklist = [
    { label: "Face images count", met: hasEnoughFaces, detail: `${approvedCount}/${target}` },
    { label: "Image mix (6 close, 6 mid, 6 full, 2 anchor)", met: mixSatisfied, detail: `Close: ${closeCount}/6, Mid: ${midCount}/6, Full: ${fullCount}/6, Anchor: ${anchorCount}/2` },
    { label: "No logos in images", met: !hasLogos, detail: hasLogos ? "Some images contain logos" : "All clear" },
    { label: "Name and token set", met: !!(identity.name && identity.token), detail: identity.name && identity.token ? "Complete" : "Missing" },
  ];

  return (
    <div className={`mb-6 rounded-lg border-2 p-4 ${
      canTrain 
        ? "bg-green-50 border-green-200" 
        : "bg-yellow-50 border-yellow-200"
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            canTrain ? "bg-green-500" : "bg-yellow-500"
          }`} />
          <div>
            <h3 className="font-semibold text-gray-900">
              Training Ready: {canTrain ? "Yes" : "No"} ({approvedCount}/{target} face images)
            </h3>
            {!canTrain && (
              <p className="text-sm text-gray-600 mt-1">
                {!hasEnoughFaces && "Need more face images. "}
                {!mixSatisfied && "Image mix incomplete. "}
                {hasLogos && "Some images contain logos. "}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          {isExpanded ? "Hide" : "Show"} checklist
        </button>
      </div>
      
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="font-medium text-gray-900 mb-2">Readiness Checklist</h4>
          <ul className="space-y-2">
            {checklist.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className={`mt-0.5 ${item.met ? "text-green-600" : "text-gray-400"}`}>
                  {item.met ? "✓" : "○"}
                </span>
                <div className="flex-1">
                  <span className={`text-sm ${item.met ? "text-gray-900" : "text-gray-600"}`}>
                    {item.label}
                  </span>
                  <span className="text-xs text-gray-500 ml-2">({item.detail})</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

