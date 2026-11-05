import { useEffect, useId, useRef, useState } from "react";
import { ImageIcon, Upload } from "lucide-react";
import type { ContentImage } from "@/domain/content";
import { imageFileError, imageReviewStatus, safeImageUrl } from "@/domain/studio-image-review";

export function FeaturedImage({ image, title }: { image: ContentImage; title: string }) {
  const [failed, setFailed] = useState(false);
  const url = safeImageUrl(image.assetUrl);
  useEffect(() => setFailed(false), [url]);
  return (
    <div className="sp-featured-image">
      {url && !failed ? (
        <img
          src={url}
          alt={image.altText || title}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="sp-image-empty">
          <ImageIcon aria-hidden="true" />
          <span>{failed ? "Image unavailable" : "Needs a featured image"}</span>
          <small>
            {failed
              ? "Open the article to review or retry."
              : "A story-specific visual belongs here."}
          </small>
        </div>
      )}
    </div>
  );
}

/** A review workspace, deliberately not a persistence or generation adapter. */
export function FeaturedImageReview({
  image,
  title,
  providerNote,
}: {
  image: ContentImage;
  title: string;
  providerNote?: string;
}) {
  const id = useId();
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [alt, setAlt] = useState(image.altText);
  const [notes, setNotes] = useState("");
  const [crop, setCrop] = useState("16 / 9");
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    },
    [localUrl],
  );
  const url = localUrl ?? safeImageUrl(image.assetUrl);
  return (
    <section className="sv-card sp-image-review" aria-label="Featured image review">
      <header className="sw-section-heading">
        <div>
          <span className="sw-kicker">FEATURED IMAGE</span>
          <h2>Make the story recognizable.</h2>
        </div>
        <span className="sw-status">
          {failed
            ? "Image unavailable"
            : localUrl
              ? "Local preview · unsaved"
              : imageReviewStatus(image)}
        </span>
      </header>
      <p className="sp-integration-note">
        Image production and saved review decisions are not connected. Nothing here changes the
        article or approves publishing.
      </p>
      <ol className="sp-image-stages" aria-label="Planned image workflow">
        <li>Needs image</li>
        <li>In production</li>
        <li>Review</li>
        <li>Approved</li>
      </ol>
      <div className="sp-image-review-grid">
        <div>
          <div className="sp-review-crop" style={{ aspectRatio: crop }}>
            {url && !failed ? (
              <img
                key={`${url}-${retry}`}
                src={url}
                alt={alt || title}
                onError={() => {
                  setFailed(true);
                  setError(
                    "This image could not be displayed. Retry it or choose another file. It is not ready for review.",
                  );
                }}
              />
            ) : (
              <div className="sp-image-empty">
                <ImageIcon aria-hidden="true" />
                <span>{failed ? "Unable to display image" : "No image to review yet"}</span>
                <small>{title}</small>
              </div>
            )}
          </div>
          <label htmlFor={`${id}-crop`}>Preview crop</label>
          <select id={`${id}-crop`} value={crop} onChange={(e) => setCrop(e.target.value)}>
            <option value="16 / 9">Landscape · 16:9</option>
            <option value="1 / 1">Square · 1:1</option>
            <option value="4 / 5">Portrait · 4:5</option>
          </select>
          <p className="sw-quiet-note">Center-crop preview only. No crop is saved or exported.</p>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose image for local preview"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (!picked) return;
              const problem = imageFileError(picked);
              if (problem) {
                setError(problem);
                return;
              }
              setError("");
              setFailed(false);
              setLocalUrl(URL.createObjectURL(picked));
            }}
          />
          <div className="sv-actions">
            <button className="sv-button" onClick={() => file.current?.click()}>
              <Upload />
              Preview your image
            </button>
            {failed && (
              <button
                className="sv-button"
                onClick={() => {
                  setFailed(false);
                  setError("");
                  setRetry(retry + 1);
                }}
              >
                Retry image
              </button>
            )}
            {localUrl && (
              <button
                className="sv-button"
                onClick={() => {
                  setLocalUrl(null);
                  setFailed(false);
                  setError("");
                }}
              >
                Discard local preview
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="sw-error">
              {error}
            </p>
          )}
        </div>
        <div className="sp-review-fields">
          <h3>Visual brief</h3>
          <p>{image.brief || "No visual brief is stored for this content yet."}</p>
          <label htmlFor={`${id}-alt`}>Alt text · unsaved</label>
          <textarea
            id={`${id}-alt`}
            value={alt}
            maxLength={1000}
            onChange={(e) => setAlt(e.target.value)}
            rows={3}
          />
          <label htmlFor={`${id}-notes`}>Revision notes · unsaved</label>
          <textarea
            id={`${id}-notes`}
            value={notes}
            maxLength={4000}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="What should this image communicate? What needs to change?"
          />
          <p className="sw-quiet-note">
            Local previews and notes are cleared when you leave this review. An existing asset has
            no verified image approval or content-revision receipt.
          </p>
          <div className="sv-actions">
            <button className="sv-button" disabled>
              Request image
            </button>
            <button className="sv-button sv-primary" disabled>
              Approve image
            </button>
          </div>
          <p className="sw-quiet-note">
            Saving uploads, revision requests and approvals needs the image storage and review
            integration. {providerNote}
          </p>
        </div>
      </div>
    </section>
  );
}
