import { formatDate } from '../lib/dates'
import type { ExpirySuggestion } from '../lib/foodApi'
import Button from './Button'
import '../styles/ExpirySuggestionCard.css'

type Props = {
  isLoading: boolean
  isError: boolean
  suggestion: ExpirySuggestion | undefined
  // The date in the form, when it came from accepting this suggestion.
  acceptedDate: string | null
  disabled: boolean
  onAccept: (date: string) => void
}

// Only ever offers a date. Nothing reaches the form until the user presses the button.
export default function ExpirySuggestionCard({
  isLoading,
  isError,
  suggestion,
  acceptedDate,
  disabled,
  onAccept,
}: Props) {
  if (isLoading) {
    return (
      <p className="expiry-suggestion expiry-suggestion-muted" role="status">
        Finding a suggested date…
      </p>
    )
  }
  if (isError) {
    return (
      <p className="expiry-suggestion expiry-suggestion-muted" role="status">
        Couldn't get a suggested date. Check the package and enter it above.
      </p>
    )
  }
  if (!suggestion) return null
  if (suggestion.status === 'none') {
    return (
      <p className="expiry-suggestion expiry-suggestion-muted" role="status">
        {suggestion.message}
      </p>
    )
  }

  const { earliest, latest, label, matchedFood, confidence, aiUsed } = suggestion
  const accepted = acceptedDate === earliest
  const range =
    earliest === latest ? formatDate(earliest) : `${formatDate(earliest)} to ${formatDate(latest)}`

  return (
    <div className="expiry-suggestion" role="status">
      <p className="expiry-suggestion-title">Suggested: {formatDate(earliest)}</p>
      <p className="expiry-suggestion-detail">
        Estimated {range} ({label}), matched to “{matchedFood}” in USDA FoodKeeper
        {aiUsed ? ' with AI help' : ''}. A date printed on the package is more reliable.
      </p>
      {confidence !== 'high' && (
        <p className="expiry-suggestion-warning">This match is uncertain. Check it against the package.</p>
      )}
      {accepted ? (
        <p className="expiry-suggestion-accepted">Using the suggested date.</p>
      ) : (
        <Button variant="secondary" disabled={disabled} onClick={() => onAccept(earliest)}>
          Use {formatDate(earliest)}
        </Button>
      )}
    </div>
  )
}
